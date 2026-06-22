import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Mirrors the Prisma GameType enum so the history filter covers every game,
// including the instant + stateful catalogue (dice/limbo/wheel/plinko, mines/
// tower/hilo). Kept in sync with `@prisma/client` GameType.
const GAME_TYPES = [
  'crash',
  'coinflip',
  'blackjack',
  'lottery',
  'jackpot',
  'dice',
  'limbo',
  'wheel',
  'plinko',
  'mines',
  'tower',
  'hilo',
] as const;
export type GameTypeFilter = (typeof GAME_TYPES)[number];

export class ListBetsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'ID of the last seen bet (cursor pagination)' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ enum: GAME_TYPES, description: 'Filter to a single game' })
  @IsOptional()
  @IsIn(GAME_TYPES)
  gameType?: GameTypeFilter;
}
