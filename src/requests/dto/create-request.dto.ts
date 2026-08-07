import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  MaxDate,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { ProductCategory } from '../../common/types/product-category.enum';
import { RequestType } from '../../common/types/request-type.enum';
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from '../schemas/request.schema';

/**
 * Note what is absent: requestNumber, status, customer and documents are all set by the
 * server. `forbidNonWhitelisted` means a client that tries to send them gets a 400.
 */
export class CreateRequestDto {
  @ApiProperty({ enum: RequestType, example: RequestType.INSURANCE_CLAIM })
  @IsEnum(RequestType)
  requestType: RequestType;

  @ApiProperty({ enum: ProductCategory, example: ProductCategory.MOTOR })
  @IsEnum(ProductCategory)
  productCategory: ProductCategory;

  @ApiProperty({ example: 'IGI-POL-0001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  policyNumber: string;

  @ApiProperty({
    example: 'Windscreen shattered by debris on the Lekki-Epe expressway.',
    minLength: DESCRIPTION_MIN,
    maxLength: DESCRIPTION_MAX,
  })
  @IsString()
  @MinLength(DESCRIPTION_MIN)
  @MaxLength(DESCRIPTION_MAX)
  description: string;

  @ApiProperty({
    example: '2026-07-15',
    description: 'ISO date. May not be in the future.',
  })
  @Type(() => Date)
  @IsDate()
  @MaxDate(() => new Date(), {
    message: 'incidentDate cannot be in the future',
  })
  incidentDate: Date;

  @ApiPropertyOptional({
    example: 'Reddington Hospital',
    description:
      'Required when requestType is HMO_PRE_AUTHORIZATION, optional otherwise.',
  })
  // SPEC.md §4 — conditionally required. @ValidateIf skips the rules below entirely for
  // an insurance claim, so the field stays genuinely optional there.
  @ValidateIf(
    (o: CreateRequestDto) =>
      o.requestType === RequestType.HMO_PRE_AUTHORIZATION,
  )
  @IsString()
  @IsNotEmpty({
    message: 'serviceProvider is required for an HMO pre-authorization request',
  })
  @MaxLength(200)
  serviceProvider?: string;

  @ApiProperty({
    example: 250000,
    description: 'NGN. Must be greater than zero.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  estimatedAmount: number;
}
