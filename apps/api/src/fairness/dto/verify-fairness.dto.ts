import { IsEnum, IsInt, IsString, Min, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyFairnessDto {
  @ApiProperty({ enum: ['crash', 'coinflip', 'blackjack'] })
  @IsEnum(['crash', 'coinflip', 'blackjack'])
  game!: 'crash' | 'coinflip' | 'blackjack';

  @ApiProperty({ description: 'Revealed server seed (64 hex chars)' })
  @IsString()
  @MinLength(32)
  serverSeed!: string;

  @ApiProperty({ description: 'Client-chosen seed' })
  @IsString()
  @MinLength(1)
  clientSeed!: string;

  @ApiProperty({ description: 'Round nonce' })
  @IsInt()
  @Min(0)
  nonce!: number;
}
