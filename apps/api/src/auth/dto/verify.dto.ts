import { IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyDto {
  @ApiProperty()
  @IsString()
  @Length(32, 44)
  walletAddress!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  nonce!: string;

  @ApiProperty({ description: 'Base58 encoded ed25519 signature' })
  @IsString()
  @MinLength(32)
  signature!: string;

  @ApiProperty({ description: 'The exact canonical message that was signed' })
  @IsString()
  @MinLength(1)
  message!: string;

  @ApiProperty({ required: false, description: 'Optional referral code captured from ?ref' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,16}$/)
  ref?: string;
}
