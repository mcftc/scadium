import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'alice_sol', minLength: 3, maxLength: 20 })
  @IsOptional()
  @IsString()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'alphanumeric + underscore only' })
  username?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'alice@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Email me on big wins' })
  @IsOptional()
  @IsBoolean()
  notifyEmailWins?: boolean;

  @ApiPropertyOptional({ description: 'Product updates email' })
  @IsOptional()
  @IsBoolean()
  notifyMarketing?: boolean;
}
