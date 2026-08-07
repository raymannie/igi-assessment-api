import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ProductCategory } from '../../common/types/product-category.enum';
import { RequestStatus } from '../../common/types/request-status.enum';
import { RequestType } from '../../common/types/request-type.enum';

/** `?status=SUBMITTED&status=ASSIGNED` arrives as an array, a single one as a string. */
const toArray = (value: unknown): unknown =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export class QueryRequestsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: RequestStatus,
    isArray: true,
    description: 'Repeatable: ?status=SUBMITTED&status=ASSIGNED',
  })
  @IsOptional()
  @Transform(({ value }) => toArray(value))
  @IsEnum(RequestStatus, { each: true })
  status?: RequestStatus[];

  @ApiPropertyOptional({ enum: RequestType })
  @IsOptional()
  @IsEnum(RequestType)
  requestType?: RequestType;

  @ApiPropertyOptional({ enum: ProductCategory })
  @IsOptional()
  @IsEnum(ProductCategory)
  productCategory?: ProductCategory;

  @ApiPropertyOptional({
    example: '2026-01-01',
    description: 'Inclusive, on createdAt.',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Inclusive, on createdAt.',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    description:
      'Officers only — limits results to requests assigned to the caller.',
  })
  @IsOptional()
  @IsBooleanString()
  assignedToMe?: string;

  @ApiPropertyOptional({
    description: 'Full-text over requestNumber, description and policyNumber.',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
