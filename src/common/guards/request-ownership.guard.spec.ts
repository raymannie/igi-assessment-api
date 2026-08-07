import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';

import { Request } from '../../requests/schemas/request.schema';
import { UserRole } from '../types/user-role.enum';
import { RequestOwnershipGuard } from './request-ownership.guard';

const OWNER = new Types.ObjectId();
const OTHER_CUSTOMER = new Types.ObjectId();
const OFFICER = new Types.ObjectId();
const REQUEST_ID = new Types.ObjectId().toString();

describe('RequestOwnershipGuard', () => {
  let guard: RequestOwnershipGuard;
  let findById: jest.Mock;

  const foundOwnedBy = (customer: Types.ObjectId | null) => ({
    select: () => ({
      lean: () => ({
        exec: () =>
          Promise.resolve(customer ? { _id: REQUEST_ID, customer } : null),
      }),
    }),
  });

  const contextFor = (
    user: { _id: Types.ObjectId; role: UserRole } | undefined,
    id: string = REQUEST_ID,
  ) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ params: { id }, user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    findById = jest.fn().mockReturnValue(foundOwnedBy(OWNER));

    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestOwnershipGuard,
        { provide: getModelToken(Request.name), useValue: { findById } },
      ],
    }).compile();

    guard = moduleRef.get(RequestOwnershipGuard);
  });

  it('lets the owning customer through', async () => {
    await expect(
      guard.canActivate(contextFor({ _id: OWNER, role: UserRole.CUSTOMER })),
    ).resolves.toBe(true);
  });

  it('lets any officer through', async () => {
    await expect(
      guard.canActivate(contextFor({ _id: OFFICER, role: UserRole.OFFICER })),
    ).resolves.toBe(true);
  });

  it("gives a customer 403 — not 404 — for someone else's request", async () => {
    // SPEC.md §6 is explicit about this: a valid token on another customer's request is
    // forbidden, not missing.
    const context = contextFor({
      _id: OTHER_CUSTOMER,
      role: UserRole.CUSTOMER,
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('carries the FORBIDDEN code', async () => {
    const context = contextFor({
      _id: OTHER_CUSTOMER,
      role: UserRole.CUSTOMER,
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
    });
  });

  it('404s when the request does not exist', async () => {
    findById.mockReturnValue(foundOwnedBy(null));
    await expect(
      guard.canActivate(contextFor({ _id: OWNER, role: UserRole.CUSTOMER })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s on a malformed id rather than letting Mongo throw', async () => {
    await expect(
      guard.canActivate(
        contextFor({ _id: OWNER, role: UserRole.CUSTOMER }, 'not-an-id'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findById).not.toHaveBeenCalled();
  });

  it('denies an unauthenticated caller', async () => {
    await expect(
      guard.canActivate(contextFor(undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reads only the customer field', async () => {
    const select = jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ customer: OWNER }) }),
    });
    findById.mockReturnValue({ select });

    await guard.canActivate(
      contextFor({ _id: OWNER, role: UserRole.CUSTOMER }),
    );
    expect(select).toHaveBeenCalledWith('customer');
  });
});
