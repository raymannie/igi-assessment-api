import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Types } from 'mongoose';
import request from 'supertest';

import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtRefreshStrategy } from '../src/auth/strategies/jwt-refresh.strategy';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { UserRole } from '../src/common/types/user-role.enum';
import { UserDocument } from '../src/users/schemas/user.schema';
import { CreateUserInput, UsersService } from '../src/users/users.service';

/**
 * Stands in for the Mongo-backed UsersService. Mirrors the two behaviours the auth flow
 * depends on: `select: false` on the hashes, and the toJSON transform that strips them.
 * (The real schema's transform is covered by src/users/schemas/user.schema.spec.ts.)
 */
class FakeUsersService {
  private readonly byId = new Map<string, Record<string, unknown>>();

  private hydrate(
    row: Record<string, unknown>,
    withSecret?: 'password' | 'refresh',
  ) {
    const doc: Record<string, unknown> = {
      _id: row._id,
      email: row.email,
      role: row.role,
      fullName: row.fullName,
      phone: row.phone,
      policyNumber: row.policyNumber,
    };
    if (withSecret === 'password') doc.passwordHash = row.passwordHash;
    if (withSecret === 'refresh') doc.refreshTokenHash = row.refreshTokenHash;
    // Closes over `doc` rather than using `this`, which would be implicitly any.
    doc.toJSON = () => {
      const plain: Record<string, unknown> = { ...doc };
      delete plain.passwordHash;
      delete plain.refreshTokenHash;
      delete plain.toJSON;
      return plain;
    };
    return doc as unknown as UserDocument;
  }

  findByEmail(email: string, withPasswordHash = false) {
    const row = [...this.byId.values()].find(
      (u) => u.email === email.toLowerCase().trim(),
    );
    return Promise.resolve(
      row ? this.hydrate(row, withPasswordHash ? 'password' : undefined) : null,
    );
  }

  findById(id: string, withRefreshTokenHash = false) {
    const row = this.byId.get(id);
    return Promise.resolve(
      row
        ? this.hydrate(row, withRefreshTokenHash ? 'refresh' : undefined)
        : null,
    );
  }

  create(input: CreateUserInput) {
    const _id = new Types.ObjectId();
    const row = { ...input, _id, email: input.email.toLowerCase() } as Record<
      string,
      unknown
    >;
    this.byId.set(_id.toString(), row);
    return Promise.resolve(this.hydrate(row, 'password'));
  }

  setRefreshTokenHash(id: string, refreshTokenHash: string) {
    const row = this.byId.get(id);
    if (row) row.refreshTokenHash = refreshTokenHash;
    return Promise.resolve();
  }

  clearRefreshToken(id: string) {
    const row = this.byId.get(id);
    if (row) delete row.refreshTokenHash;
    return Promise.resolve();
  }

  roleOf(id: string) {
    return this.byId.get(id)?.role;
  }
}

const TEST_ENV = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
};

const REGISTRATION = {
  email: 'Chidi.Nwosu@Example.com',
  password: 'Customer123',
  fullName: 'Chidi Nwosu',
  policyNumber: 'IGI-POL-0001',
};

/** supertest types responses loosely; narrow at the call site. */
interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details: unknown[] };
}
const env = (body: unknown) => body as Envelope;

const cookiesFrom = (res: request.Response): string[] => {
  const raw: unknown = res.headers['set-cookie'];
  if (Array.isArray(raw)) return raw as string[];
  return typeof raw === 'string' ? [raw] : [];
};
const refreshCookie = (res: request.Response): string =>
  cookiesFrom(res).find((c) => c.startsWith('refreshToken=')) ?? '';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let users: FakeUsersService;

  beforeEach(async () => {
    users = new FakeUsersService();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => TEST_ENV],
        }),
        PassportModule,
        JwtModule.register({}),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        JwtRefreshStrategy,
        { provide: UsersService, useValue: users },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  const register = (body: Record<string, unknown> = REGISTRATION) =>
    request(server()).post('/api/v1/auth/register').send(body);

  const login = (email: string, password: string) =>
    request(server()).post('/api/v1/auth/login').send({ email, password });

  describe('register', () => {
    it('creates the account and signs the user in', async () => {
      const res = await register().expect(201);
      const body = env(res.body);

      expect(body.success).toBe(true);
      expect(body.data?.accessToken).toEqual(expect.any(String));
      expect((body.data?.user as Record<string, unknown>).email).toBe(
        'chidi.nwosu@example.com',
      );
      expect(refreshCookie(res)).toContain('HttpOnly');
      expect(refreshCookie(res)).toContain('Path=/api/v1/auth');
    });

    it('always assigns the CUSTOMER role', async () => {
      const res = await register().expect(201);
      const user = env(res.body).data?.user as Record<string, unknown>;
      expect(user.role).toBe(UserRole.CUSTOMER);
      expect(users.roleOf(String(user._id))).toBe(UserRole.CUSTOMER);
    });

    it('rejects an attempt to self-assign OFFICER', async () => {
      const res = await register({ ...REGISTRATION, role: 'OFFICER' }).expect(
        400,
      );
      expect(env(res.body).error?.code).toBe('VALIDATION_ERROR');
    });

    it('never returns the password hash', async () => {
      const res = await register().expect(201);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('rejects a password with no digit', async () => {
      const res = await register({ ...REGISTRATION, password: 'onlyletters' });
      expect(res.status).toBe(400);
      expect(env(res.body).error?.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a password under 8 characters', async () => {
      await register({ ...REGISTRATION, password: 'Ab1' }).expect(400);
    });

    it('rejects a duplicate email regardless of casing', async () => {
      await register().expect(201);
      const res = await register({
        ...REGISTRATION,
        email: 'CHIDI.NWOSU@example.com',
      }).expect(409);
      expect(env(res.body).error?.code).toBe('DUPLICATE_KEY');
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await register().expect(201);
    });

    it('signs in with correct credentials', async () => {
      const res = await login(REGISTRATION.email, REGISTRATION.password).expect(
        200,
      );
      expect(env(res.body).data?.accessToken).toEqual(expect.any(String));
    });

    it('gives the same generic 401 for a wrong password and an unknown email', async () => {
      const wrongPassword = await login(
        REGISTRATION.email,
        'Wrong12345',
      ).expect(401);
      const unknownEmail = await login(
        'nobody@example.com',
        'Customer123',
      ).expect(401);

      expect(env(wrongPassword.body).error?.code).toBe('UNAUTHORIZED');
      // Byte-identical wording is what stops the endpoint enumerating accounts: the
      // caller cannot tell "no such user" from "wrong password".
      expect(env(wrongPassword.body).error?.message).toBe(
        env(unknownEmail.body).error?.message,
      );
      expect(env(unknownEmail.body).error?.code).toBe('UNAUTHORIZED');
      // ...and it must not echo back which account was attempted.
      expect(JSON.stringify(unknownEmail.body)).not.toContain(
        'nobody@example.com',
      );
    });
  });

  describe('me', () => {
    it('rejects a request with no token', async () => {
      const res = await request(server()).get('/api/v1/auth/me').expect(401);
      expect(env(res.body).error?.code).toBe('UNAUTHORIZED');
    });

    it('rejects a token signed with the refresh secret', async () => {
      // Proves the two secrets are genuinely separate.
      const registered = await register().expect(201);
      const cookie = refreshCookie(registered);
      const refreshToken = cookie.split(';')[0].replace('refreshToken=', '');

      await request(server())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${decodeURIComponent(refreshToken)}`)
        .expect(401);
    });

    it('returns the current user for a valid token', async () => {
      const registered = await register().expect(201);
      const token = env(registered.body).data?.accessToken as string;

      const res = await request(server())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((env(res.body).data as Record<string, unknown>).email).toBe(
        'chidi.nwosu@example.com',
      );
      expect(JSON.stringify(res.body)).not.toContain('Hash');
    });
  });

  describe('refresh', () => {
    it('issues a new access token and a new cookie', async () => {
      const registered = await register().expect(201);

      const res = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie(registered))
        .expect(200);

      expect(env(res.body).data?.accessToken).toEqual(expect.any(String));
      expect(refreshCookie(res)).not.toBe('');
    });

    it('invalidates the previous token once rotated', async () => {
      const registered = await register().expect(201);
      const original = refreshCookie(registered);

      const rotated = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', original)
        .expect(200);

      // The heart of rotation: replaying the old cookie must now fail. This is what
      // breaks if the refresh token is bcrypt-ed raw, since bcrypt only reads 72 bytes
      // and two tokens for the same user share a longer prefix than that.
      const replay = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', original)
        .expect(401);
      expect(env(replay.body).error?.code).toBe('UNAUTHORIZED');

      // ...while the freshly-issued one still works.
      await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie(rotated))
        .expect(200);
    });

    it('rejects a missing cookie', async () => {
      await request(server()).post('/api/v1/auth/refresh').expect(401);
    });
  });

  describe('logout', () => {
    it('clears the cookie and stops the refresh token working', async () => {
      const registered = await register().expect(201);
      const token = env(registered.body).data?.accessToken as string;
      const cookie = refreshCookie(registered);

      const res = await request(server())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(cookiesFrom(res).some((c) => c.startsWith('refreshToken=;'))).toBe(
        true,
      );

      await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    });

    it('requires authentication', async () => {
      await request(server()).post('/api/v1/auth/logout').expect(401);
    });
  });
});
