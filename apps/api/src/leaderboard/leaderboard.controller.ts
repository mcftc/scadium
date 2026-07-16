import { Controller, Get, Query } from '@nestjs/common';
import { parseLimit } from '../common/parse-limit';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeaderboardService } from './leaderboard.service';

@ApiTags('leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly lb: LeaderboardService) {}

  @Get('volume')
  @ApiOperation({ summary: 'Top players by total wagered volume' })
  topByVolume(@Query('limit') limit?: string) {
    return this.lb.topByVolume(parseLimit(limit, 50, 100));
  }

  @Get('profit')
  @ApiOperation({ summary: 'Top players by total profit' })
  topByProfit(@Query('limit') limit?: string) {
    return this.lb.topByProfit(parseLimit(limit, 50, 100));
  }
}
