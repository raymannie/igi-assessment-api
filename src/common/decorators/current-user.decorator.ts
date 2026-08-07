import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Whatever the active Passport strategy's `validate()` returned.
 * For `jwt` that is the UserDocument; for `jwt-refresh` it is a RefreshContext.
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as Record<string, unknown> | undefined;
    return data && user ? user[data] : user;
  },
);
