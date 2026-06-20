import { IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Privy social-login exchange (#203). The ONLY trusted field is `accessToken`:
 * it's a Privy-issued ES256 JWT verified server-side. No identity (email,
 * wallet) is accepted from the client — it's sourced from Privy after the token
 * verifies. `ref` mirrors the SIWS verify DTO (affiliate code from ?ref).
 */
export class PrivyLoginDto {
  @ApiProperty({ description: "Privy access token from the browser's getAccessToken()" })
  @IsString()
  @MinLength(16)
  accessToken!: string;

  @ApiProperty({ required: false, description: 'Optional referral code captured from ?ref' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,16}$/)
  ref?: string;
}
