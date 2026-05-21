import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class NonceRequestDto {
  @ApiProperty({ description: 'Solana wallet address (base58)' })
  @IsString()
  @Length(32, 44)
  walletAddress!: string;
}
