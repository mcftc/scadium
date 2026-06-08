import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'alice_sol', minLength: 3, maxLength: 20 })
  @IsOptional()
  @IsString()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'alphanumeric + underscore only' })
  username?: string;

  // Accepts an http(s) URL, an inline data:image URL (client-uploaded /
  // generated avatar), or an empty string to clear it.
  @ApiPropertyOptional({ example: 'data:image/webp;base64,…' })
  @IsOptional()
  @IsString()
  @MaxLength(120_000)
  @Matches(/^(data:image\/|https?:\/\/|$)/, { message: 'avatarUrl must be an image URL or data URL' })
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
