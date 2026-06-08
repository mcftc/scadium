import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SOCIAL_PROVIDERS = ['google', 'telegram', 'discord'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export class ConnectionDto {
  @ApiProperty({ enum: SOCIAL_PROVIDERS })
  @IsIn(SOCIAL_PROVIDERS)
  provider!: SocialProvider;

  @ApiPropertyOptional({ description: 'Linked handle/email; omit or empty to unlink' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  account?: string;
}
