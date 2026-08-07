import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { RequestStatus } from '../../common/types/request-status.enum';

export class UpdateStatusDto {
  @ApiProperty({
    enum: RequestStatus,
    example: RequestStatus.UNDER_REVIEW,
    description:
      'The target status. Legality is decided by the transition table in SPEC §3.',
  })
  @IsEnum(RequestStatus)
  status: RequestStatus;

  @ApiPropertyOptional({
    example: 'Please upload the police report.',
    description:
      'Required when moving to NEEDS_ADDITIONAL_INFO or DENIED; optional otherwise.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment?: string;
}
