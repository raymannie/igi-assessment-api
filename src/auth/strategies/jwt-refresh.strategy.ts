import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';

import { UsersService } from '../../users/users.service';
import { REFRESH_COOKIE_NAME } from '../auth.constants';
import { JwtPayload, RefreshContext } from '../types/jwt-payload.interface';

/** The refresh token lives only in the httpOnly cookie, never in a header. */
function cookieExtractor(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME] ?? null;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: cookieExtractor,
      ignoreExpiration: false,
      // Deliberately a different secret from the access token, so an access token can
      // never be replayed as a refresh token or vice versa.
      secretOrKey: config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  /**
   * Only proves the cookie's signature is ours. Matching it against the stored hash —
   * which is what makes rotation meaningful — happens in AuthService.refresh.
   */
  async validate(req: Request, payload: JwtPayload): Promise<RefreshContext> {
    const refreshToken = cookieExtractor(req);
    const user = refreshToken
      ? await this.usersService.findById(payload.sub, true)
      : null;

    if (!refreshToken || !user) {
      throw new UnauthorizedException({
        message: 'Invalid or expired session',
        code: 'UNAUTHORIZED',
      });
    }

    return { user, refreshToken };
  }
}
