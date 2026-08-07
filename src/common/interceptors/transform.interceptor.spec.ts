import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import {
  ResponseEnvelope,
  TransformInterceptor,
} from './transform.interceptor';

describe('TransformInterceptor', () => {
  const interceptor = new TransformInterceptor();
  const context = {} as ExecutionContext;

  const run = (payload: unknown): Promise<ResponseEnvelope<unknown>> => {
    const next: CallHandler = { handle: () => of(payload) };
    return firstValueFrom(interceptor.intercept(context, next));
  };

  it('wraps an object', async () => {
    await expect(run({ id: 1 })).resolves.toEqual({
      success: true,
      data: { id: 1 },
    });
  });

  it('wraps an array without treating it as paginated', async () => {
    await expect(run([1, 2])).resolves.toEqual({ success: true, data: [1, 2] });
  });

  it('hoists meta when the handler returns { items, meta }', async () => {
    await expect(run({ items: ['a'], meta: { total: 1 } })).resolves.toEqual({
      success: true,
      data: ['a'],
      meta: { total: 1 },
    });
  });

  it('does not treat a partial shape as paginated', async () => {
    await expect(run({ items: ['a'] })).resolves.toEqual({
      success: true,
      data: { items: ['a'] },
    });
  });

  it('passes null through as data', async () => {
    await expect(run(null)).resolves.toEqual({ success: true, data: null });
  });
});
