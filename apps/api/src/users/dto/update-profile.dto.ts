import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'alice_sol', minLength: 3, maxLength: 20 })
  @IsOptional()
  @IsString()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'alphanumeric + underscore only' })
  username?: string;

  // Accepts an http(s) URL, an inline base64 RASTER-image data URL
  // (client-uploaded / generated avatar), or an empty string to clear it.
  // SVG data URLs are rejected: they can carry <script>/onload and are a
  // stored-XSS vector if ever rendered inline (#H-avatar). The size cap bounds
  // per-user Postgres blob abuse — the durable fix is object storage (a Railway
  // bucket), deferred to the platform migration.
  @ApiPropertyOptional({ example: 'data:image/webp;base64,…' })
  @IsOptional()
  @IsString()
  @MaxLength(120_000)
  @Matches(/^(data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+|https?:\/\/|$)/, {
    message: 'avatarUrl must be an http(s) URL, a base64 png/jpeg/webp/gif data URL, or empty',
  })
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
