import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { parseLimit } from '../common/parse-limit';
import { LiveFeedService } from './live-feed.service';
import type { LiveBetEvent } from './live-feed.types';

@ApiTags('live')
@Controller('live')
export class LiveController {
  constructor(private readonly feed: LiveFeedService) {}

  @Get('bets')
  @ApiOperation({ summary: 'Recent settled bets across all games (sitewide live-feed seed)' })
  @ApiQuery({ name: 'limit', required: false, description: '1–50, default 20' })
  @ApiQuery({ name: 'wins', required: false, description: 'true → big-wins only' })
  bets(@Query('limit') limit?: string, @Query('wins') wins?: string): Promise<LiveBetEvent[]> {
    return this.feed.recentBets(parseLimit(limit, 20, 50), wins === 'true');
  }
}
