import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Registered globally, so every route is authenticated unless it opts out with @Public.
 * Routes using a different strategy (e.g. jwt-refresh) must also be marked @Public so
 * this guard steps aside and lets their own guard run.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return isPublic ? true : super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw new UnauthorizedException({
        message: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }
    return user;
  }
}
