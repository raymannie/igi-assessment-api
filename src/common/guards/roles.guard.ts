import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../types/user-role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user: { role?: UserRole } | undefined = request.user;

    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException({
        message: 'You do not have permission to perform this action',
        code: 'FORBIDDEN',
      });
    }

    return true;
  }
}
