import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Trigger the buy-and-burn job now (normally on a 10-min timer)' })
  async runBurn() {
    await this.swap.runBuyAndBurn();
    return this.swap.recentBurns(1);
  }
}
