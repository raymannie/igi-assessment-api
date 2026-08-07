import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { UserDocument } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../types/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /** Re-reads the user so a deleted account cannot keep using an unexpired token. */
  async validate(payload: JwtPayload): Promise<UserDocument> {
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException({
        message: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    return user;
  }
}
