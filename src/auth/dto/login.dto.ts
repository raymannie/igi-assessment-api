import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'customer@igi.test', format: 'email' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @ApiProperty({ example: 'Customer123' })
  @IsString()
  @MinLength(1, { message: 'password must not be empty' })
  password: string;
}
