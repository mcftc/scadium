import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DistributionService } from './distribution.service';

/**
 * Public (unauthenticated) SCAD Engine read endpoints: engine-wide stats and the
 * distribution-rounds feed. User-specific staking state lives under /staking.
 */
@ApiTags('engine')
@Controller('engine')
export class EngineController {
  constructor(private readonly distribution: DistributionService) {}

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
}
