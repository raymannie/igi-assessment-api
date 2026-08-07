import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Request as HttpRequest } from 'express';
import { Model, Types } from 'mongoose';

import {
  Request,
  HydratedRequest,
} from '../../requests/schemas/request.schema';
import { UserRole } from '../types/user-role.enum';

/**
 * CLAUDE.md pattern 3 — this answers "may *this* user touch *this* request?", which is a
 * separate question from RolesGuard's "is this an officer?". Both run on request-scoped
 * routes.
 *
 * A customer who does not own the request gets 403, not 404 (SPEC.md §6). That leaks the
 * existence of the id, which is the trade-off the spec asks for.
 */
@Injectable()
export class RequestOwnershipGuard implements CanActivate {
  constructor(
    @InjectModel(Request.name)
    private readonly requestModel: Model<HydratedRequest>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp().getRequest<HttpRequest>();
    // Express 5 types route params as string | string[].
    const rawId: unknown = http.params.id;
    const id = typeof rawId === 'string' ? rawId : undefined;
    const user: { _id?: Types.ObjectId; role?: UserRole } | undefined =
      http.user;

    // ParseObjectIdPipe runs after guards, so the id has not been checked yet.
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new NotFoundException({
        message: 'Request not found',
        code: 'NOT_FOUND',
      });
    }

    const found = await this.requestModel
      .findById(id)
      .select('customer')
      .lean()
      .exec();

    if (!found) {
      throw new NotFoundException({
        message: 'Request not found',
        code: 'NOT_FOUND',
      });
    }

    if (user?.role === UserRole.OFFICER) return true;

    if (found.customer.toString() !== user?._id?.toString()) {
      throw new ForbiddenException({
        message: 'You do not have access to this request',
        code: 'FORBIDDEN',
      });
    }

    return true;
  }
}
