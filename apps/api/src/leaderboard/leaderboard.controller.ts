import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeaderboardService } from './leaderboard.service';

@ApiTags('leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly lb: LeaderboardService) {}

  @Get('volume')
  @ApiOperation({ summary: 'Top players by total wagered volume' })
  topByVolume(@Query('limit') limit?: string) {
    return this.lb.topByVolume(limit ? parseInt(limit, 10) : 50);
  }

  @Get('profit')
  @ApiOperation({ summary: 'Top players by total profit' })
  topByProfit(@Query('limit') limit?: string) {
    return this.lb.topByProfit(limit ? parseInt(limit, 10) : 50);
  }
}
