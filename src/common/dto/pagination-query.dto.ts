import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

/** Whitelisted so `sortBy` can never reach Mongo as arbitrary user input. */
export const SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'incidentDate',
  'estimatedAmount',
  'requestNumber',
  'status',
] as const;

export type SortOrder = 'asc' | 'desc';

const toInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_PAGE, minimum: 1, example: 1 })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? DEFAULT_PAGE : toInt(value, DEFAULT_PAGE),
  )
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    default: DEFAULT_LIMIT,
    maximum: MAX_LIMIT,
    example: 10,
    description: `Clamped to ${MAX_LIMIT} server-side; a larger value is reduced rather than rejected.`,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined
      ? DEFAULT_LIMIT
      : Math.min(Math.max(toInt(value, DEFAULT_LIMIT), 1), MAX_LIMIT),
  )
  @IsInt()
  @Min(1)
  limit: number = DEFAULT_LIMIT;

  @ApiPropertyOptional({ enum: SORTABLE_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORTABLE_FIELDS)
  sortBy: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: SortOrder = 'desc';
}
