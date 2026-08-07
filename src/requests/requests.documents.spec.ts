import { ConflictException, ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';

import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../common/types/audit-action.enum';
import { RequestStatus } from '../common/types/request-status.enum';
import { UserRole } from '../common/types/user-role.enum';
import { StoredFile, UploadsService } from '../uploads/uploads.service';
import { UserDocument } from '../users/schemas/user.schema';
import { CountersService } from './counters.service';
import { RequestsService } from './requests.service';
import { Request } from './schemas/request.schema';

const REQUEST_ID = new Types.ObjectId().toString();
const ASSIGNEE_ID = new Types.ObjectId();
const OTHER_OFFICER_ID = new Types.ObjectId();
const CUSTOMER_ID = new Types.ObjectId();

const asUser = (id: Types.ObjectId, role: UserRole, fullName: string) =>
  ({ _id: id, role, fullName, email: 'x@e.st' }) as unknown as UserDocument;

const ASSIGNEE = asUser(ASSIGNEE_ID, UserRole.OFFICER, 'Adaeze Okonkwo');
const OTHER_OFFICER = asUser(
  OTHER_OFFICER_ID,
  UserRole.OFFICER,
  'Tunde Bakare',
);
const CUSTOMER = asUser(CUSTOMER_ID, UserRole.CUSTOMER, 'Chidi Nwosu');

const file = (originalname: string): Express.Multer.File =>
  ({
    originalname,
    mimetype: 'application/pdf',
    size: 100,
    buffer: Buffer.from('x'),
  }) as Express.Multer.File;

const stored = (fileName: string, publicId: string): StoredFile => ({
  url: `https://res.cloudinary.com/${publicId}`,
  publicId,
  fileName,
  mimeType: 'application/pdf',
  size: 100,
});

describe('RequestsService — documents', () => {
  let service: RequestsService;
  let uploadFile: jest.Mock;
  let deleteFile: jest.Mock;
  let updateOne: jest.Mock;
  let findOneAndUpdate: jest.Mock;
  let log: jest.Mock;
  let current: {
    status: RequestStatus;
    assignedOfficer: Types.ObjectId | null;
  };

  const callArgs = (mock: jest.Mock, call = 0): unknown[] =>
    (mock.mock.calls as unknown[][])[call];

  const pushedDocuments = () => {
    const update = callArgs(updateOne)[1] as {
      $push: { documents: { $each: Record<string, unknown>[] } };
    };
    return update.$push.documents.$each;
  };

  const auditEntry = () => callArgs(log)[0] as Record<string, unknown>;

  beforeEach(async () => {
    current = {
      status: RequestStatus.UNDER_REVIEW,
      assignedOfficer: ASSIGNEE_ID,
    };

    const chain: Record<string, () => unknown> = {
      select: () => chain,
      populate: () => chain,
      lean: () => chain,
      exec: () => Promise.resolve({ _id: REQUEST_ID, ...current }),
    };

    uploadFile = jest
      .fn()
      .mockImplementation((f: Express.Multer.File) =>
        Promise.resolve(stored(f.originalname, `pid-${f.originalname}`)),
      );
    deleteFile = jest.fn().mockResolvedValue(true);
    updateOne = jest.fn().mockReturnValue({ exec: () => Promise.resolve({}) });
    findOneAndUpdate = jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ _id: REQUEST_ID }) }),
    });
    log = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestsService,
        {
          provide: getModelToken(Request.name),
          useValue: { findById: () => chain, updateOne, findOneAndUpdate },
        },
        {
          provide: CountersService,
          useValue: { nextRequestNumber: jest.fn() },
        },
        { provide: AuditService, useValue: { log, findByRequest: jest.fn() } },
        { provide: UploadsService, useValue: { uploadFile, deleteFile } },
      ],
    }).compile();

    service = moduleRef.get(RequestsService);
  });

  describe('addDocuments', () => {
    it('uploads into the request-scoped folder', async () => {
      await service.addDocuments(REQUEST_ID, CUSTOMER, [file('a.pdf')]);
      expect(callArgs(uploadFile)[1]).toBe(`igi-portal/requests/${REQUEST_ID}`);
    });

    it('stamps each document with the uploader and a timestamp', async () => {
      await service.addDocuments(REQUEST_ID, CUSTOMER, [file('a.pdf')]);

      expect(pushedDocuments()[0]).toMatchObject({
        fileName: 'a.pdf',
        publicId: 'pid-a.pdf',
        mimeType: 'application/pdf',
        uploadedBy: CUSTOMER_ID,
      });
      expect(pushedDocuments()[0].uploadedAt).toBeInstanceOf(Date);
    });

    it('writes all files in a single push', async () => {
      await service.addDocuments(REQUEST_ID, CUSTOMER, [
        file('a.pdf'),
        file('b.pdf'),
        file('c.pdf'),
      ]);
      expect(updateOne).toHaveBeenCalledTimes(1);
      expect(pushedDocuments()).toHaveLength(3);
    });

    it('logs one DOCUMENT_UPLOADED entry naming every file', async () => {
      await service.addDocuments(REQUEST_ID, CUSTOMER, [
        file('a.pdf'),
        file('b.pdf'),
      ]);

      expect(log).toHaveBeenCalledTimes(1);
      expect(auditEntry()).toMatchObject({
        action: AuditAction.DOCUMENT_UPLOADED,
        actor: CUSTOMER_ID,
        metadata: { fileNames: ['a.pdf', 'b.pdf'] },
      });
    });

    it('lets the assigned officer upload', async () => {
      await expect(
        service.addDocuments(REQUEST_ID, ASSIGNEE, [file('a.pdf')]),
      ).resolves.toBeDefined();
    });

    it('403s an officer who is not the assignee', async () => {
      await expect(
        service.addDocuments(REQUEST_ID, OTHER_OFFICER, [file('a.pdf')]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it.each([
      RequestStatus.APPROVED,
      RequestStatus.DENIED,
      RequestStatus.WITHDRAWN,
    ])('409s when the request is %s', async (status) => {
      current.status = status;
      await expect(
        service.addDocuments(REQUEST_ID, CUSTOMER, [file('a.pdf')]),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it.each([
      RequestStatus.SUBMITTED,
      RequestStatus.ASSIGNED,
      RequestStatus.UNDER_REVIEW,
      RequestStatus.NEEDS_ADDITIONAL_INFO,
    ])('allows uploads while %s', async (status) => {
      current.status = status;
      await expect(
        service.addDocuments(REQUEST_ID, CUSTOMER, [file('a.pdf')]),
      ).resolves.toBeDefined();
    });
  });

  describe('partial upload failure', () => {
    beforeEach(() => {
      uploadFile.mockImplementation((f: Express.Multer.File) =>
        f.originalname === 'bad.pdf'
          ? Promise.reject(new Error('cloudinary exploded'))
          : Promise.resolve(stored(f.originalname, `pid-${f.originalname}`)),
      );
    });

    it('does not write a half-filled documents array', async () => {
      await expect(
        service.addDocuments(REQUEST_ID, CUSTOMER, [
          file('good.pdf'),
          file('bad.pdf'),
          file('also-good.pdf'),
        ]),
      ).rejects.toThrow();

      expect(updateOne).not.toHaveBeenCalled();
    });

    it('deletes the files that did upload, leaving no orphans', async () => {
      await expect(
        service.addDocuments(REQUEST_ID, CUSTOMER, [
          file('good.pdf'),
          file('bad.pdf'),
        ]),
      ).rejects.toThrow();

      expect(deleteFile).toHaveBeenCalledWith('pid-good.pdf');
    });

    it('writes no audit entry', async () => {
      await expect(
        service.addDocuments(REQUEST_ID, CUSTOMER, [
          file('good.pdf'),
          file('bad.pdf'),
        ]),
      ).rejects.toThrow();

      expect(log).not.toHaveBeenCalled();
    });
  });

  describe('respond with attachments', () => {
    beforeEach(() => {
      current = {
        status: RequestStatus.NEEDS_ADDITIONAL_INFO,
        assignedOfficer: ASSIGNEE_ID,
      };
    });

    it('uploads before moving the request back under review', async () => {
      await service.respond(REQUEST_ID, CUSTOMER, { message: 'here it is' }, [
        file('a.pdf'),
      ]);

      const uploadOrder = uploadFile.mock.invocationCallOrder[0];
      const transitionOrder = findOneAndUpdate.mock.invocationCallOrder[0];
      expect(uploadOrder).toBeLessThan(transitionOrder);
    });

    it('leaves the status alone when an upload fails', async () => {
      uploadFile.mockRejectedValue(new Error('cloudinary exploded'));

      await expect(
        service.respond(REQUEST_ID, CUSTOMER, { message: 'x' }, [
          file('a.pdf'),
        ]),
      ).rejects.toThrow();

      expect(findOneAndUpdate).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('names the attachments on the CUSTOMER_RESPONDED entry', async () => {
      await service.respond(REQUEST_ID, CUSTOMER, { message: 'here it is' }, [
        file('a.pdf'),
        file('b.pdf'),
      ]);

      expect(auditEntry()).toMatchObject({
        action: AuditAction.CUSTOMER_RESPONDED,
        comment: 'here it is',
        metadata: { fileNames: ['a.pdf', 'b.pdf'] },
      });
    });

    it('still works with no attachments, and adds no metadata', async () => {
      await service.respond(REQUEST_ID, CUSTOMER, { message: 'no files' });

      expect(uploadFile).not.toHaveBeenCalled();
      expect(updateOne).not.toHaveBeenCalled();
      expect(auditEntry()).not.toHaveProperty('metadata');
    });
  });
});
