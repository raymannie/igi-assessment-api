import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RespondDto {
  @ApiProperty({
    example: 'The police report is attached, reference LG/2026/4471.',
    description:
      'Recorded as the comment on the CUSTOMER_RESPONDED audit entry.',
  })
  @IsString()
  @MinLength(1, { message: 'message must not be empty' })
  @MaxLength(2000)
  message: string;
}
