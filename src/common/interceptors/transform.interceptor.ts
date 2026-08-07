import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseEnvelope<T> {
  success: true;
  data: T;
  meta?: unknown;
}

/** A handler returning this shape gets its `meta` hoisted alongside `data`. */
interface PaginatedResult {
  items: unknown;
  meta: unknown;
}

function isPaginated(value: unknown): value is PaginatedResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'meta' in value
  );
}

/**
 * Shapes every successful response into the envelope from SPEC.md §6:
 *   { success: true, data }                  — normal handlers
 *   { success: true, data: items, meta }     — handlers returning { items, meta }
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ResponseEnvelope<unknown>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ResponseEnvelope<unknown>> {
    return next.handle().pipe(
      map((payload) =>
        isPaginated(payload)
          ? {
              success: true as const,
              data: payload.items,
              meta: payload.meta,
            }
          : { success: true as const, data: payload },
      ),
    );
  }
}
