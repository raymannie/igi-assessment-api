import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';

import { UserRole } from '../common/types/user-role.enum';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { BCRYPT_COST } from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './types/jwt-payload.interface';

export interface AuthResult {
  user: UserDocument;
  accessToken: string;
  refreshToken: string;
}

/**
 * bcrypt only reads the first 72 bytes of its input. A refresh JWT is much longer than
 * that, and two tokens issued for the same user share a long identical prefix (header +
 * the leading fields of the payload) — so bcrypt-ing the raw token would let a rotated-out
 * token still compare equal, silently defeating rotation. Collapsing to a fixed-length
 * digest first keeps every byte of the token significant.
 */
const digest = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException({
        message: 'An account with this email already exists',
        code: 'DUPLICATE_KEY',
      });
    }

    const user = await this.usersService.create({
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_COST),
      fullName: dto.fullName,
      phone: dto.phone,
      policyNumber: dto.policyNumber,
      // Never taken from the request body — officers are seeded (SPEC.md §11.1).
      role: UserRole.CUSTOMER,
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email, true);

    // One generic failure for both "no such email" and "wrong password", so the endpoint
    // cannot be used to enumerate registered accounts (SPEC.md §8).
    const passwordMatches =
      user && (await bcrypt.compare(dto.password, user.passwordHash));

    if (!user || !passwordMatches) {
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        code: 'UNAUTHORIZED',
      });
    }

    return this.issueTokens(user);
  }

  /** Verifies the presented cookie against the stored hash, then rotates both tokens. */
  async refresh(
    user: UserDocument,
    presentedToken: string,
  ): Promise<AuthResult> {
    const storedHash = user.refreshTokenHash;
    const matches =
      storedHash && (await bcrypt.compare(digest(presentedToken), storedHash));

    if (!matches) {
      // Either a logged-out session or a replayed/stale token.
      throw new UnauthorizedException({
        message: 'Invalid or expired session',
        code: 'UNAUTHORIZED',
      });
    }

    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.usersService.clearRefreshToken(userId);
  }

  /** Joi guarantees these are present; jsonwebtoken just types them narrower than string. */
  private ttl(key: string): JwtSignOptions['expiresIn'] {
    return this.config.getOrThrow<string>(key) as JwtSignOptions['expiresIn'];
  }

  private async issueTokens(user: UserDocument): Promise<AuthResult> {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.ttl('JWT_ACCESS_TTL'),
      }),
      // The jti makes every refresh token unique. Without it, `iat` only has one-second
      // resolution, so two refreshes inside the same second mint a byte-identical token
      // — and rotation would silently invalidate nothing.
      this.jwtService.signAsync(
        { ...payload, jti: randomUUID() },
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.ttl('JWT_REFRESH_TTL'),
        },
      ),
    ]);

    await this.usersService.setRefreshTokenHash(
      payload.sub,
      await bcrypt.hash(digest(refreshToken), BCRYPT_COST),
    );

    return { user, accessToken, refreshToken };
  }
}
