import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DistributionService } from './distribution.service';
import { BlockMiningService } from './block-mining.service';
import { JwtAuthGuard, type AuthContext } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

/**
 * SCAD Engine read endpoints. Most are public (engine-wide observability + the
 * Proof-of-Play mining feed); `/engine/me` is authed (per-miner state). The
 * legacy USDS distribution feed lives under summary/rounds.
 */
@ApiTags('engine')
@Controller('engine')
export class EngineController {
  constructor(
    private readonly distribution: DistributionService,
    private readonly blockMining: BlockMiningService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Engine stats: staked, burned, USDS distributed, rates' })
  summary() {
    return this.distribution.engineStats();
  }

  @Get('rounds')
  @ApiOperation({ summary: 'Recent USDS distribution rounds (newest first)' })
  rounds(@Query('limit') limit?: string) {
    return this.distribution.recentRounds(limit ? Number(limit) : 30);
  }

  // ---- Proof-of-Play mining (Engine v2) ----

  @Get('state')
  @ApiOperation({ summary: 'Mining state: phase, halving, emitted/remaining, block reward, countdown' })
  state() {
    return this.blockMining.state();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Your current-hour play-rate + projected block share' })
  me(@CurrentUser() ctx: AuthContext) {
    return this.blockMining.minerState(ctx.userId);
  }

  @Get('blocks')
  @ApiOperation({ summary: 'Recent mined blocks (reward, winner, proof) — newest first' })
  blocks(@Query('limit') limit?: string) {
    return this.blockMining.recentBlocks(limit ? Number(limit) : 30);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Current-hour play-rate ranking (top miners)' })
  leaderboard(@Query('limit') limit?: string) {
    return this.blockMining.currentLeaderboard(limit ? Number(limit) : 25);
  }
}
