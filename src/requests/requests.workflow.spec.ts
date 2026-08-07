import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';

import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../common/types/audit-action.enum';
import { RequestStatus } from '../common/types/request-status.enum';
import { UserRole } from '../common/types/user-role.enum';
import { UserDocument } from '../users/schemas/user.schema';
import { UploadsService } from '../uploads/uploads.service';
import { CountersService } from './counters.service';
import { RequestsService } from './requests.service';
import { Request } from './schemas/request.schema';

const REQUEST_ID = new Types.ObjectId().toString();
const ASSIGNEE_ID = new Types.ObjectId();
const OTHER_OFFICER_ID = new Types.ObjectId();
const CUSTOMER_ID = new Types.ObjectId();

const asUser = (id: Types.ObjectId, role: UserRole, fullName: string) =>
  ({
    _id: id,
    role,
    fullName,
    email: `${fullName}@e.st`,
  }) as unknown as UserDocument;

const ASSIGNEE = asUser(ASSIGNEE_ID, UserRole.OFFICER, 'Adaeze Okonkwo');
const OTHER_OFFICER = asUser(
  OTHER_OFFICER_ID,
  UserRole.OFFICER,
  'Tunde Bakare',
);
const CUSTOMER = asUser(CUSTOMER_ID, UserRole.CUSTOMER, 'Chidi Nwosu');

describe('RequestsService — workflow transitions', () => {
  let service: RequestsService;
  let findOneAndUpdate: jest.Mock;
  let log: jest.Mock;
  let current: {
    status: RequestStatus;
    assignedOfficer: Types.ObjectId | null;
  };

  const callArgs = (mock: jest.Mock, call = 0): unknown[] =>
    (mock.mock.calls as unknown[][])[call];

  const arg = <T>(mock: jest.Mock, index: number): T =>
    callArgs(mock)[index] as T;

  /** The filter the conditional update ran against. */
  const updateFilter = () => arg<Record<string, unknown>>(findOneAndUpdate, 0);
  const updateSet = () =>
    arg<{ $set: Record<string, unknown> }>(findOneAndUpdate, 1).$set;
  const auditEntry = () => callArgs(log)[0] as Record<string, unknown>;

  beforeEach(async () => {
    current = { status: RequestStatus.SUBMITTED, assignedOfficer: null };

    // findById serves both loadForMutation (.select) and findById (.populate).
    const chain: Record<string, () => unknown> = {
      select: () => chain,
      populate: () => chain,
      lean: () => chain,
      exec: () => Promise.resolve({ _id: REQUEST_ID, ...current }),
    };

    // By default the conditional update matches; individual tests simulate a lost race.
    findOneAndUpdate = jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ _id: REQUEST_ID }) }),
    });
    log = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestsService,
        {
          provide: getModelToken(Request.name),
          useValue: { findById: () => chain, findOneAndUpdate },
        },
        {
          provide: CountersService,
          useValue: { nextRequestNumber: jest.fn() },
        },
        { provide: AuditService, useValue: { log, findByRequest: jest.fn() } },
        {
          provide: UploadsService,
          useValue: { uploadFile: jest.fn(), deleteFile: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(RequestsService);
  });

  const loseTheRace = () =>
    findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(null) }),
    });

  describe('assign', () => {
    it('claims an unassigned SUBMITTED request', async () => {
      await service.assign(REQUEST_ID, ASSIGNEE);

      expect(updateSet()).toMatchObject({
        status: RequestStatus.ASSIGNED,
        assignedOfficer: ASSIGNEE_ID,
      });
    });

    it('only matches while the request is still unclaimed', async () => {
      await service.assign(REQUEST_ID, ASSIGNEE);

      // Two officers assigning at once must not both succeed.
      expect(updateFilter()).toMatchObject({
        _id: REQUEST_ID,
        status: RequestStatus.SUBMITTED,
        assignedOfficer: null,
      });
    });

    it('409s when another officer won the race', async () => {
      loseTheRace();
      await expect(service.assign(REQUEST_ID, ASSIGNEE)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('409s when it is already assigned', async () => {
      current.assignedOfficer = OTHER_OFFICER_ID;
      await expect(service.assign(REQUEST_ID, ASSIGNEE)).rejects.toMatchObject({
        response: { code: 'INVALID_TRANSITION' },
      });
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('409s when the request is not SUBMITTED', async () => {
      current.status = RequestStatus.UNDER_REVIEW;
      await expect(service.assign(REQUEST_ID, ASSIGNEE)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('logs REQUEST_ASSIGNED with both statuses', async () => {
      await service.assign(REQUEST_ID, ASSIGNEE);

      expect(auditEntry()).toMatchObject({
        action: AuditAction.REQUEST_ASSIGNED,
        actor: ASSIGNEE_ID,
        actorRole: UserRole.OFFICER,
        actorName: 'Adaeze Okonkwo',
        fromStatus: RequestStatus.SUBMITTED,
        toStatus: RequestStatus.ASSIGNED,
      });
    });

    it('does not log when the transition fails', async () => {
      loseTheRace();
      await expect(service.assign(REQUEST_ID, ASSIGNEE)).rejects.toThrow();
      expect(log).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => {
      current = {
        status: RequestStatus.ASSIGNED,
        assignedOfficer: ASSIGNEE_ID,
      };
    });

    it('lets the assignee move ASSIGNED -> UNDER_REVIEW', async () => {
      await service.updateStatus(REQUEST_ID, ASSIGNEE, {
        status: RequestStatus.UNDER_REVIEW,
      });
      expect(updateSet()).toMatchObject({ status: RequestStatus.UNDER_REVIEW });
    });

    it('403s for an officer who is not the assignee', async () => {
      await expect(
        service.updateStatus(REQUEST_ID, OTHER_OFFICER, {
          status: RequestStatus.UNDER_REVIEW,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('409s when nobody is assigned yet', async () => {
      current.assignedOfficer = null;
      await expect(
        service.updateStatus(REQUEST_ID, ASSIGNEE, {
          status: RequestStatus.UNDER_REVIEW,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('routes through the transition table — ASSIGNED -> APPROVED is illegal', async () => {
      await expect(
        service.updateStatus(REQUEST_ID, ASSIGNEE, {
          status: RequestStatus.APPROVED,
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_TRANSITION' } });
    });

    it('enforces the comment requirement', async () => {
      current.status = RequestStatus.UNDER_REVIEW;
      await expect(
        service.updateStatus(REQUEST_ID, ASSIGNEE, {
          status: RequestStatus.DENIED,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses the customer-driven move out of NEEDS_ADDITIONAL_INFO', async () => {
      current.status = RequestStatus.NEEDS_ADDITIONAL_INFO;
      await expect(
        service.updateStatus(REQUEST_ID, ASSIGNEE, {
          status: RequestStatus.UNDER_REVIEW,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to let an officer withdraw a request', async () => {
      current.status = RequestStatus.NEEDS_ADDITIONAL_INFO;
      await expect(
        service.updateStatus(REQUEST_ID, ASSIGNEE, {
          status: RequestStatus.WITHDRAWN,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cannot revive a terminal request', async () => {
      current.status = RequestStatus.APPROVED;
      await expect(
        service.updateStatus(REQUEST_ID, ASSIGNEE, {
          status: RequestStatus.UNDER_REVIEW,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('pins the update to the status it validated against', async () => {
      current.status = RequestStatus.UNDER_REVIEW;
      await service.updateStatus(REQUEST_ID, ASSIGNEE, {
        status: RequestStatus.APPROVED,
      });
      // Prevents a concurrent APPROVE and DENY from both landing.
      expect(updateFilter()).toMatchObject({
        status: RequestStatus.UNDER_REVIEW,
      });
    });

    it('409s if the status moved underneath it', async () => {
      current.status = RequestStatus.UNDER_REVIEW;
      loseTheRace();
      await expect(
        service.updateStatus(REQUEST_ID, ASSIGNEE, {
          status: RequestStatus.APPROVED,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('logs STATUS_CHANGED with from, to and the comment', async () => {
      current.status = RequestStatus.UNDER_REVIEW;
      await service.updateStatus(REQUEST_ID, ASSIGNEE, {
        status: RequestStatus.DENIED,
        comment: 'Outside policy cover',
      });

      expect(auditEntry()).toMatchObject({
        action: AuditAction.STATUS_CHANGED,
        fromStatus: RequestStatus.UNDER_REVIEW,
        toStatus: RequestStatus.DENIED,
        comment: 'Outside policy cover',
      });
    });
  });

  describe('respond', () => {
    beforeEach(() => {
      current = {
        status: RequestStatus.NEEDS_ADDITIONAL_INFO,
        assignedOfficer: ASSIGNEE_ID,
      };
    });

    it('moves the request back to UNDER_REVIEW automatically', async () => {
      await service.respond(REQUEST_ID, CUSTOMER, {
        message: 'Report attached',
      });
      expect(updateSet()).toMatchObject({ status: RequestStatus.UNDER_REVIEW });
    });

    it('logs CUSTOMER_RESPONDED with the message as the comment', async () => {
      await service.respond(REQUEST_ID, CUSTOMER, {
        message: 'Report attached',
      });

      expect(auditEntry()).toMatchObject({
        action: AuditAction.CUSTOMER_RESPONDED,
        actor: CUSTOMER_ID,
        actorRole: UserRole.CUSTOMER,
        fromStatus: RequestStatus.NEEDS_ADDITIONAL_INFO,
        toStatus: RequestStatus.UNDER_REVIEW,
        comment: 'Report attached',
      });
    });

    it('refuses to respond to an ASSIGNED request', async () => {
      // ASSIGNED -> UNDER_REVIEW is a legal transition, so the transition table alone
      // would have allowed this. Only the current-status guard stops it.
      current.status = RequestStatus.ASSIGNED;
      await expect(
        service.respond(REQUEST_ID, CUSTOMER, { message: 'x' }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_TRANSITION' } });
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([
      RequestStatus.SUBMITTED,
      RequestStatus.UNDER_REVIEW,
      RequestStatus.APPROVED,
      RequestStatus.DENIED,
      RequestStatus.WITHDRAWN,
    ])('refuses to respond while %s', async (status) => {
      current.status = status;
      await expect(
        service.respond(REQUEST_ID, CUSTOMER, { message: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('withdraw', () => {
    beforeEach(() => {
      current = {
        status: RequestStatus.NEEDS_ADDITIONAL_INFO,
        assignedOfficer: ASSIGNEE_ID,
      };
    });

    it('withdraws from NEEDS_ADDITIONAL_INFO', async () => {
      await service.withdraw(REQUEST_ID, CUSTOMER);
      expect(updateSet()).toMatchObject({ status: RequestStatus.WITHDRAWN });
    });

    it('logs REQUEST_WITHDRAWN', async () => {
      await service.withdraw(REQUEST_ID, CUSTOMER);

      expect(auditEntry()).toMatchObject({
        action: AuditAction.REQUEST_WITHDRAWN,
        actor: CUSTOMER_ID,
        fromStatus: RequestStatus.NEEDS_ADDITIONAL_INFO,
        toStatus: RequestStatus.WITHDRAWN,
      });
    });

    it.each([
      RequestStatus.SUBMITTED,
      RequestStatus.ASSIGNED,
      RequestStatus.UNDER_REVIEW,
      RequestStatus.APPROVED,
    ])('refuses to withdraw while %s', async (status) => {
      current.status = status;
      await expect(
        service.withdraw(REQUEST_ID, CUSTOMER),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('audit discipline', () => {
    it('writes exactly one entry per successful mutation', async () => {
      await service.assign(REQUEST_ID, ASSIGNEE);
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('records the request id on every entry', async () => {
      await service.assign(REQUEST_ID, ASSIGNEE);
      expect(auditEntry().request?.toString()).toBe(REQUEST_ID);
    });
  });
});
