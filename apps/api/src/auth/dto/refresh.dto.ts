import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'The opaque refresh token issued at sign-in / last rotation' })
  @IsString()
  @MinLength(16)
  refreshToken!: string;
}
