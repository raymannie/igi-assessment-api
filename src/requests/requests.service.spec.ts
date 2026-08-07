import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';

import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../common/types/audit-action.enum';
import { ProductCategory } from '../common/types/product-category.enum';
import { RequestStatus } from '../common/types/request-status.enum';
import { RequestType } from '../common/types/request-type.enum';
import { UserRole } from '../common/types/user-role.enum';
import { UserDocument } from '../users/schemas/user.schema';
import { CountersService } from './counters.service';
import { QueryRequestsDto } from './dto/query-requests.dto';
import { RequestsService } from './requests.service';
import { Request } from './schemas/request.schema';

const CUSTOMER_ID = new Types.ObjectId();
const OFFICER_ID = new Types.ObjectId();

const asUser = (id: Types.ObjectId, role: UserRole) =>
  ({
    _id: id,
    role,
    fullName: 'Test User',
    email: 't@e.st',
  }) as unknown as UserDocument;

const CUSTOMER = asUser(CUSTOMER_ID, UserRole.CUSTOMER);
const OFFICER = asUser(OFFICER_ID, UserRole.OFFICER);

const query = (plain: Record<string, unknown> = {}) =>
  plainToInstance(QueryRequestsDto, plain, { enableImplicitConversion: true });

describe('RequestsService', () => {
  let service: RequestsService;
  let find: jest.Mock;
  let countDocuments: jest.Mock;
  let create: jest.Mock;
  let log: jest.Mock;

  /** jest types call arguments as `any`; read them through one narrowing helper. */
  const callArg = (mock: jest.Mock, call = 0): Record<string, unknown> =>
    (mock.mock.calls as unknown[][])[call][0] as Record<string, unknown>;

  /** Captures the filter object handed to find(). */
  const filterPassedToFind = () => callArg(find);

  beforeEach(async () => {
    const findByIdChain: Record<string, () => unknown> = {
      populate: () => findByIdChain,
      lean: () => findByIdChain,
      exec: () =>
        Promise.resolve({ _id: 'x', requestNumber: 'CLM-2026-000001' }),
    };

    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      populate: () => chain,
      lean: () => chain,
      exec: () => Promise.resolve([]),
    };
    find = jest.fn().mockReturnValue(chain);
    countDocuments = jest
      .fn()
      .mockReturnValue({ exec: () => Promise.resolve(0) });
    create = jest.fn();
    log = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestsService,
        {
          provide: getModelToken(Request.name),
          useValue: {
            find,
            countDocuments,
            create,
            findById: () => findByIdChain,
          },
        },
        {
          provide: CountersService,
          useValue: {
            nextRequestNumber: () => Promise.resolve('CLM-2026-000001'),
          },
        },
        { provide: AuditService, useValue: { log, findByRequest: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(RequestsService);
  });

  describe('scoping', () => {
    it('restricts a customer to their own requests', async () => {
      await service.findAll(CUSTOMER, query());
      expect(filterPassedToFind()).toMatchObject({ customer: CUSTOMER_ID });
    });

    it('does not scope an officer to any customer', async () => {
      await service.findAll(OFFICER, query());
      expect(filterPassedToFind()).not.toHaveProperty('customer');
    });

    it('ignores assignedToMe for a customer, keeping their own scope', async () => {
      // A customer must not be able to widen their view by passing officer-only filters.
      await service.findAll(CUSTOMER, query({ assignedToMe: 'true' }));
      const filter = filterPassedToFind();
      expect(filter).toMatchObject({ customer: CUSTOMER_ID });
      expect(filter).not.toHaveProperty('assignedOfficer');
    });

    it('honours assignedToMe for an officer', async () => {
      await service.findAll(OFFICER, query({ assignedToMe: 'true' }));
      expect(filterPassedToFind()).toMatchObject({
        assignedOfficer: OFFICER_ID,
      });
    });

    it('leaves assignedOfficer unset when assignedToMe is false', async () => {
      await service.findAll(OFFICER, query({ assignedToMe: 'false' }));
      expect(filterPassedToFind()).not.toHaveProperty('assignedOfficer');
    });
  });

  describe('filters', () => {
    it('uses $in for repeated statuses', async () => {
      await service.findAll(
        OFFICER,
        query({ status: [RequestStatus.SUBMITTED, RequestStatus.ASSIGNED] }),
      );
      expect(filterPassedToFind()).toMatchObject({
        status: { $in: [RequestStatus.SUBMITTED, RequestStatus.ASSIGNED] },
      });
    });

    it('passes type and category straight through', async () => {
      await service.findAll(
        OFFICER,
        query({
          requestType: RequestType.HMO_PRE_AUTHORIZATION,
          productCategory: ProductCategory.HEALTH,
        }),
      );
      expect(filterPassedToFind()).toMatchObject({
        requestType: RequestType.HMO_PRE_AUTHORIZATION,
        productCategory: ProductCategory.HEALTH,
      });
    });

    it('builds an inclusive createdAt range', async () => {
      await service.findAll(
        OFFICER,
        query({ dateFrom: '2026-01-01', dateTo: '2026-12-31' }),
      );
      const { createdAt } = filterPassedToFind() as {
        createdAt: { $gte: Date; $lte: Date };
      };
      expect(createdAt.$gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      // dateTo must cover the whole final day, not just its midnight.
      expect(createdAt.$lte.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    });

    it('omits createdAt entirely when no dates are given', async () => {
      await service.findAll(OFFICER, query());
      expect(filterPassedToFind()).not.toHaveProperty('createdAt');
    });

    it('uses the text index for search', async () => {
      await service.findAll(OFFICER, query({ search: '  windscreen ' }));
      expect(filterPassedToFind()).toMatchObject({
        $text: { $search: 'windscreen' },
      });
    });

    it('ignores a blank search', async () => {
      await service.findAll(OFFICER, query({ search: '   ' }));
      expect(filterPassedToFind()).not.toHaveProperty('$text');
    });

    it('counts with the same filter it queries with', async () => {
      await service.findAll(
        CUSTOMER,
        query({ status: [RequestStatus.APPROVED] }),
      );
      expect(callArg(countDocuments)).toEqual(filterPassedToFind());
    });
  });

  describe('pagination meta', () => {
    it('reports totalPages from the total and limit', async () => {
      countDocuments.mockReturnValue({ exec: () => Promise.resolve(23) });
      const result = await service.findAll(
        OFFICER,
        query({ limit: '10', page: '2' }),
      );
      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 23,
        totalPages: 3,
      });
    });

    it('reports zero pages for an empty result', async () => {
      const result = await service.findAll(OFFICER, query());
      expect(result.meta).toMatchObject({ total: 0, totalPages: 0 });
    });
  });

  describe('create', () => {
    beforeEach(() => {
      create.mockResolvedValue({
        _id: new Types.ObjectId(),
        requestNumber: 'CLM-2026-000001',
        status: RequestStatus.SUBMITTED,
      });
    });

    const dto = {
      requestType: RequestType.INSURANCE_CLAIM,
      productCategory: ProductCategory.MOTOR,
      policyNumber: 'IGI-POL-0001',
      description: 'A long enough description.',
      incidentDate: new Date('2026-07-15'),
      estimatedAmount: 1000,
    };

    it('creates against the acting customer with a generated number', async () => {
      await service.create(CUSTOMER, dto);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: CUSTOMER_ID,
          requestNumber: 'CLM-2026-000001',
        }),
      );
    });

    it('never lets the caller choose the status or assignee', async () => {
      await service.create(CUSTOMER, {
        ...dto,
        status: RequestStatus.APPROVED,
        assignedOfficer: OFFICER_ID,
      } as never);
      const payload = callArg(create);
      expect(payload.status).toBeUndefined();
      expect(payload.assignedOfficer).toBeUndefined();
    });

    it('writes a REQUEST_CREATED audit entry in the same flow', async () => {
      await service.create(CUSTOMER, dto);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.REQUEST_CREATED,
          actor: CUSTOMER_ID,
          actorRole: UserRole.CUSTOMER,
          actorName: 'Test User',
          toStatus: RequestStatus.SUBMITTED,
        }),
      );
    });
  });
});
