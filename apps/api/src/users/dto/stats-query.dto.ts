import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const STATS_WINDOWS = ['all', '24h', '7d', '1m'] as const;
export type StatsWindow = (typeof STATS_WINDOWS)[number];

export class StatsQueryDto {
  @ApiPropertyOptional({ enum: STATS_WINDOWS, default: 'all' })
  @IsOptional()
  @IsIn(STATS_WINDOWS)
  window?: StatsWindow;
}
