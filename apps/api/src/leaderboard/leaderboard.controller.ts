import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { parseLimit } from '../common/parse-limit';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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

  @Get('window')
  @ApiOperation({ summary: 'Windowed board by wagered volume (today / this week)' })
  @ApiQuery({ name: 'period', enum: ['daily', 'weekly'], required: true })
  @ApiQuery({ name: 'limit', required: false })
  windowedTop(@Query('period') period?: string, @Query('limit') limit?: string) {
    if (period !== 'daily' && period !== 'weekly') {
      throw new BadRequestException("period must be 'daily' or 'weekly'");
    }
    return this.lb.windowedTop(period, parseLimit(limit, 50, 100));
  }

  @Get('race')
  @ApiOperation({ summary: 'Live daily-race standings, prize pool and UTC-midnight reset' })
  @ApiQuery({ name: 'limit', required: false })
  race(@Query('limit') limit?: string) {
    return this.lb.raceStandings(parseLimit(limit, 50, 100));
  }
}
