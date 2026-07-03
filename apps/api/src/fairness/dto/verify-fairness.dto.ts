import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MINES } from '@scadium/shared';

const VERIFY_GAMES = ['crash', 'coinflip', 'blackjack', 'mines', 'hilo', 'tower'] as const;
export type VerifyGame = (typeof VERIFY_GAMES)[number];

export class VerifyFairnessDto {
  @ApiProperty({ enum: VERIFY_GAMES })
  @IsEnum(VERIFY_GAMES)
  game!: VerifyGame;

  @ApiPropertyOptional({
    description: 'Mines only — the round’s mine count',
    minimum: MINES.MIN_MINES,
    maximum: MINES.MAX_MINES,
  })
  @IsOptional()
  @IsInt()
  @Min(MINES.MIN_MINES)
  @Max(MINES.MAX_MINES)
  mines?: number;

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
