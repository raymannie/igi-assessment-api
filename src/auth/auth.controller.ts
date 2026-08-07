import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { UserDocument } from '../users/schemas/user.schema';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from './auth.constants';
import { AuthResult, AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { RefreshContext } from './types/jwt-payload.interface';

/** SPEC.md §8 — 10 requests per minute per IP on the credential endpoints. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @ApiOperation({
    summary: 'Register a new customer',
    description:
      'Always creates a CUSTOMER. Officer accounts are seeded by an administrator and ' +
      'can never be created through this endpoint. Signs the new user in immediately.',
  })
  @ApiResponse({ status: 201, description: 'Account created and signed in.' })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR — the body failed validation.',
  })
  @ApiResponse({
    status: 409,
    description: 'DUPLICATE_KEY — that email is already registered.',
  })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(await this.authService.register(dto), res);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Returns a short-lived access token in the body and sets the long-lived refresh ' +
      'token as an httpOnly cookie scoped to /api/v1/auth.',
  })
  @ApiResponse({ status: 200, description: 'Signed in.' })
  @ApiResponse({
    status: 401,
    description:
      'UNAUTHORIZED — wrong email or password. The message is deliberately generic so ' +
      'the endpoint cannot be used to discover which emails are registered.',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(await this.authService.login(dto), res);
  }

  // @Public keeps the global JwtAuthGuard away — this route authenticates with the
  // refresh cookie instead, via its own guard.
  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiCookieAuth(REFRESH_COOKIE_NAME)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description:
      'Verifies the refresh cookie against its stored hash, then issues a new access ' +
      'token and a brand-new refresh cookie. The presented token stops working.',
  })
  @ApiResponse({ status: 200, description: 'New access token issued.' })
  @ApiResponse({
    status: 401,
    description:
      'UNAUTHORIZED — the cookie is missing, expired, or already rotated out.',
  })
  async refresh(
    @CurrentUser() ctx: RefreshContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.refresh(ctx.user, ctx.refreshToken);
    return this.respondWithSession(result, res);
  }

  @ApiBearerAuth('access-token')
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign out',
    description: 'Clears the stored refresh token hash and the cookie.',
  })
  @ApiResponse({ status: 200, description: 'Signed out.' })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED — no valid access token.',
  })
  async logout(
    @CurrentUser() user: UserDocument,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user._id.toString());
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
    // The envelope already carries `success`; nesting another one here just reads oddly.
    return { message: 'Signed out' };
  }

  @ApiBearerAuth('access-token')
  @Get('me')
  @ApiOperation({ summary: 'The currently authenticated user' })
  @ApiResponse({ status: 200, description: 'The current user.' })
  @ApiResponse({
    status: 401,
    description: 'UNAUTHORIZED — no valid access token.',
  })
  me(@CurrentUser() user: UserDocument) {
    return user;
  }

  /** Sets the rotated refresh cookie and returns the SPEC §6 login payload. */
  private respondWithSession(result: AuthResult, res: Response) {
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, this.cookieOptions());
    return { accessToken: result.accessToken, user: result.user };
  }

  private cookieOptions() {
    return refreshCookieOptions(
      this.config.get<string>('NODE_ENV') === 'production',
    );
  }
}
