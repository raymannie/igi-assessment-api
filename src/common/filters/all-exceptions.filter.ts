import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details: unknown[];
  };
}

/** SPEC.md §6 — the default code for each status we emit. */
const STATUS_CODE_MAP: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'INVALID_TRANSITION',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'FILE_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_FILE_TYPE',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
};

const MONGO_DUPLICATE_KEY = 11000;

/** Plain number, not `HttpStatus.INTERNAL_SERVER_ERROR`: `status` is a number and
 *  no-unsafe-enum-comparison rejects mixing the two. */
const SERVER_ERROR_THRESHOLD = 500;

interface HttpExceptionBody {
  message?: string | string[];
  code?: string;
  details?: unknown[];
}

function isMongoDuplicateKeyError(
  exception: unknown,
): exception is { code: number; keyValue?: Record<string, unknown> } {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'code' in exception &&
    exception.code === MONGO_DUPLICATE_KEY
  );
}

/**
 * Shapes every thrown error into the envelope from SPEC.md §6.
 *
 * An explicit `code` on the exception payload always wins over the status map — that is
 * how narrower codes like COMMENT_REQUIRED reach the client from a 400.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.resolve(exception);

    if (status >= SERVER_ERROR_THRESHOLD) {
      // Stack stays in the logs; the client only ever sees the generic message above.
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${body.error.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; body: ErrorEnvelope } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { status, body: this.envelope(status, payload) };
      }

      const { message, code, details } = payload as HttpExceptionBody;
      // ValidationPipe hands back message as string[]; that belongs in `details`.
      const isFieldErrors = Array.isArray(message);

      return {
        status,
        body: this.envelope(
          status,
          isFieldErrors
            ? 'Request validation failed'
            : (message ?? exception.message),
          details ?? (isFieldErrors ? message : []),
          code,
        ),
      };
    }

    if (isMongoDuplicateKeyError(exception)) {
      const field = Object.keys(exception.keyValue ?? {})[0];
      return {
        status: HttpStatus.CONFLICT,
        body: this.envelope(
          HttpStatus.CONFLICT,
          field
            ? `A record with this ${field} already exists`
            : 'A record with these details already exists',
          [],
          'DUPLICATE_KEY',
        ),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: this.envelope(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'An unexpected error occurred',
      ),
    };
  }

  private envelope(
    status: number,
    message: string,
    details: unknown[] = [],
    code?: string,
  ): ErrorEnvelope {
    return {
      success: false,
      error: {
        code: code ?? STATUS_CODE_MAP[status] ?? 'INTERNAL_ERROR',
        message,
        details,
      },
    };
  }
}
