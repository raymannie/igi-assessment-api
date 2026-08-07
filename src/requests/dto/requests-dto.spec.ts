import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { MAX_LIMIT } from '../../common/dto/pagination-query.dto';
import { ProductCategory } from '../../common/types/product-category.enum';
import { RequestStatus } from '../../common/types/request-status.enum';
import { RequestType } from '../../common/types/request-type.enum';
import { CreateRequestDto } from './create-request.dto';
import { QueryRequestsDto } from './query-requests.dto';

/** Mirrors the global ValidationPipe's transform options. */
const toDto = <T>(cls: new () => T, plain: Record<string, unknown>): T =>
  plainToInstance(cls, plain, { enableImplicitConversion: true });

const errorsFor = (dto: object) =>
  validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).flatMap(
    (e) => Object.keys(e.constraints ?? {}).map(() => e.property),
  );

const VALID_CLAIM = {
  requestType: RequestType.INSURANCE_CLAIM,
  productCategory: ProductCategory.MOTOR,
  policyNumber: 'IGI-POL-0001',
  description: 'Windscreen shattered by debris on the expressway.',
  incidentDate: '2026-07-15',
  estimatedAmount: 250000,
};

describe('CreateRequestDto', () => {
  it('accepts a valid insurance claim with no serviceProvider', () => {
    expect(errorsFor(toDto(CreateRequestDto, VALID_CLAIM))).toEqual([]);
  });

  it('requires serviceProvider for an HMO pre-authorization', () => {
    const errors = errorsFor(
      toDto(CreateRequestDto, {
        ...VALID_CLAIM,
        requestType: RequestType.HMO_PRE_AUTHORIZATION,
      }),
    );
    expect(errors).toContain('serviceProvider');
  });

  it('accepts an HMO pre-authorization that supplies serviceProvider', () => {
    const errors = errorsFor(
      toDto(CreateRequestDto, {
        ...VALID_CLAIM,
        requestType: RequestType.HMO_PRE_AUTHORIZATION,
        serviceProvider: 'Reddington Hospital',
      }),
    );
    expect(errors).toEqual([]);
  });

  it('rejects a future incidentDate', () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const errors = errorsFor(
      toDto(CreateRequestDto, {
        ...VALID_CLAIM,
        incidentDate: nextYear.toISOString(),
      }),
    );
    expect(errors).toContain('incidentDate');
  });

  it("accepts today's date", () => {
    const errors = errorsFor(
      toDto(CreateRequestDto, {
        ...VALID_CLAIM,
        incidentDate: new Date(Date.now() - 1000).toISOString(),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('rejects a description under 10 characters', () => {
    expect(
      errorsFor(
        toDto(CreateRequestDto, { ...VALID_CLAIM, description: 'short' }),
      ),
    ).toContain('description');
  });

  it('rejects a zero or negative amount', () => {
    expect(
      errorsFor(
        toDto(CreateRequestDto, { ...VALID_CLAIM, estimatedAmount: 0 }),
      ),
    ).toContain('estimatedAmount');
    expect(
      errorsFor(
        toDto(CreateRequestDto, { ...VALID_CLAIM, estimatedAmount: -5 }),
      ),
    ).toContain('estimatedAmount');
  });

  it('rejects an unknown enum value', () => {
    expect(
      errorsFor(
        toDto(CreateRequestDto, {
          ...VALID_CLAIM,
          productCategory: 'AVIATION',
        }),
      ),
    ).toContain('productCategory');
  });
});

describe('QueryRequestsDto', () => {
  it('applies defaults when nothing is supplied', () => {
    const dto = toDto(QueryRequestsDto, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
    expect(dto.sortBy).toBe('createdAt');
    expect(dto.sortOrder).toBe('desc');
    expect(errorsFor(dto)).toEqual([]);
  });

  it('wraps a single status into an array', () => {
    const dto = toDto(QueryRequestsDto, { status: RequestStatus.SUBMITTED });
    expect(dto.status).toEqual([RequestStatus.SUBMITTED]);
    expect(errorsFor(dto)).toEqual([]);
  });

  it('keeps repeated status values', () => {
    const dto = toDto(QueryRequestsDto, {
      status: [RequestStatus.SUBMITTED, RequestStatus.ASSIGNED],
    });
    expect(dto.status).toEqual([
      RequestStatus.SUBMITTED,
      RequestStatus.ASSIGNED,
    ]);
    expect(errorsFor(dto)).toEqual([]);
  });

  it('rejects an unknown status', () => {
    expect(errorsFor(toDto(QueryRequestsDto, { status: 'NOPE' }))).toContain(
      'status',
    );
  });

  it('clamps limit to the server maximum rather than rejecting it', () => {
    expect(toDto(QueryRequestsDto, { limit: '500' }).limit).toBe(MAX_LIMIT);
    expect(toDto(QueryRequestsDto, { limit: '25' }).limit).toBe(25);
  });

  it('floors limit at 1', () => {
    expect(toDto(QueryRequestsDto, { limit: '0' }).limit).toBe(1);
    expect(toDto(QueryRequestsDto, { limit: '-3' }).limit).toBe(1);
  });

  it('falls back to the default for a non-numeric limit', () => {
    expect(toDto(QueryRequestsDto, { limit: 'abc' }).limit).toBe(10);
  });

  it('coerces page from a query string', () => {
    expect(toDto(QueryRequestsDto, { page: '3' }).page).toBe(3);
  });

  it('rejects a sortBy outside the whitelist', () => {
    expect(
      errorsFor(toDto(QueryRequestsDto, { sortBy: 'passwordHash' })),
    ).toContain('sortBy');
  });

  it('accepts a whitelisted sortBy', () => {
    expect(
      errorsFor(toDto(QueryRequestsDto, { sortBy: 'estimatedAmount' })),
    ).toEqual([]);
  });

  it('rejects a malformed date', () => {
    expect(
      errorsFor(toDto(QueryRequestsDto, { dateFrom: 'last tuesday' })),
    ).toContain('dateFrom');
  });

  it('accepts assignedToMe as a query-string boolean', () => {
    expect(
      errorsFor(toDto(QueryRequestsDto, { assignedToMe: 'true' })),
    ).toEqual([]);
    expect(
      errorsFor(toDto(QueryRequestsDto, { assignedToMe: 'maybe' })),
    ).toContain('assignedToMe');
  });
});
