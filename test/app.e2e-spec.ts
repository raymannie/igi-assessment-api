import {
  Body,
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  Post,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, ValidationPipe } from '@nestjs/common';
import { IsInt, IsString } from 'class-validator';
import request from 'supertest';

import {
  AllExceptionsFilter,
  ErrorEnvelope,
} from '../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

/** supertest types `res.body` as `any`; narrow it at each call site. */
const asError = (body: unknown) => body as ErrorEnvelope;

class SampleDto {
  @IsString()
  name: string;

  @IsInt()
  age: number;
}

@Controller('probe')
class ProbeController {
  @Get('plain')
  plain() {
    return { hello: 'world' };
  }

  @Get('paginated')
  paginated() {
    return {
      items: [1, 2, 3],
      meta: { page: 1, limit: 10, total: 3, totalPages: 1 },
    };
  }

  @Get('conflict')
  conflict(): never {
    throw new HttpException({ message: 'Bad move' }, HttpStatus.CONFLICT);
  }

  @Get('explicit-code')
  explicitCode(): never {
    throw new HttpException(
      { message: 'A comment is required', code: 'COMMENT_REQUIRED' },
      HttpStatus.BAD_REQUEST,
    );
  }

  @Get('duplicate')
  duplicate(): never {
    throw Object.assign(new Error('E11000 dup key'), {
      code: 11000,
      keyValue: { email: 'a@b.test' },
    });
  }

  @Get('boom')
  boom(): never {
    throw new Error('internal detail that must not leak');
  }

  @Post('validated')
  validated(@Body() dto: SampleDto) {
    return dto;
  }
}

/**
 * Exercises the global response envelope, exception filter and validation pipe from
 * main.ts against a throwaway controller — no DB, no feature modules.
 */
describe('Application shell (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
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

  afterAll(async () => {
    await app.close();
  });

  it('wraps a plain response in the success envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/plain')
      .expect(200);
    expect(res.body).toEqual({ success: true, data: { hello: 'world' } });
  });

  it('hoists meta for a { items, meta } response', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/paginated')
      .expect(200);
    expect(res.body).toEqual({
      success: true,
      data: [1, 2, 3],
      meta: { page: 1, limit: 10, total: 3, totalPages: 1 },
    });
  });

  it('enforces the global prefix', async () => {
    await request(app.getHttpServer()).get('/probe/plain').expect(404);
  });

  it('maps 409 to INVALID_TRANSITION', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/conflict')
      .expect(409);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'INVALID_TRANSITION', message: 'Bad move', details: [] },
    });
  });

  it('lets an explicit code override the status map', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/explicit-code')
      .expect(400);
    expect(asError(res.body).error.code).toBe('COMMENT_REQUIRED');
  });

  it('maps Mongo 11000 to 409 DUPLICATE_KEY', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/duplicate')
      .expect(409);
    expect(asError(res.body).error.code).toBe('DUPLICATE_KEY');
    expect(asError(res.body).error.message).toContain('email');
  });

  it('does not leak internals on a 500', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe/boom')
      .expect(500);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [],
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('internal detail');
  });

  it('reports validation failures as VALIDATION_ERROR with details', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/validated')
      .send({ name: 'ok' })
      .expect(400);
    expect(asError(res.body).success).toBe(false);
    expect(asError(res.body).error.code).toBe('VALIDATION_ERROR');
    expect(asError(res.body).error.details.length).toBeGreaterThan(0);
  });

  it('rejects unknown properties', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/validated')
      .send({ name: 'ok', age: 30, rogue: 'nope' })
      .expect(400);
    expect(JSON.stringify(asError(res.body).error.details)).toContain('rogue');
  });
});
