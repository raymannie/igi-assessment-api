import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** SPEC.md §8 — min 8 chars, at least one letter and one number. */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export class RegisterDto {
  @ApiProperty({ example: 'chidi.nwosu@example.com', format: 'email' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @ApiProperty({
    example: 'Customer123',
    minLength: 8,
    description:
      'At least 8 characters, containing at least one letter and one number.',
  })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(72, { message: 'password must not exceed 72 characters' })
  @Matches(PASSWORD_RULE, {
    message: 'password must contain at least one letter and one number',
  })
  password: string;

  @ApiProperty({ example: 'Chidi Nwosu' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: 'IGI-POL-0001' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  policyNumber?: string;
}
