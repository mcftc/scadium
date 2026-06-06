import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SwapService } from './swap.service';

@ApiTags('swap')
@Controller('swap')
export class SwapController {
  constructor(private readonly swap: SwapService) {}

  @Get('pool')
  @ApiOperation({ summary: 'SCAD/SOL pool reserves, price, TVL' })
  pool() {
    return this.swap.poolInfo();
  }

  @Get('trades')
  @ApiOperation({ summary: 'Recent swaps decoded from on-chain events' })
  trades(@Query('limit') limit?: string) {
    return this.swap.recentTrades(limit ? Number(limit) : 25);
  }

  @Get('burns')
  @ApiOperation({ summary: 'Buy-and-burn history (20% of NGR)' })
  burns(@Query('limit') limit?: string) {
    return this.swap.recentBurns(limit ? Number(limit) : 20);
  }

  @Post('burns/run')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: trigger the buy-and-burn job now (normally on a 10-min timer)' })
  async runBurn(@CurrentUser() ctx: AuthContext) {
    await this.swap.assertAdmin(ctx.userId);
    await this.swap.runBuyAndBurn();
    return this.swap.recentBurns(1);
  }
}
