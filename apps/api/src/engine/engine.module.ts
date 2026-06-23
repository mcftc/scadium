import { Module } from '@nestjs/common';
import { EngineController } from './engine.controller';
import { DistributionService } from './distribution.service';
import { BlockMiningService } from './block-mining.service';

/**
 * SCAD Engine module — owns the hourly GGR→USDS distribution job
 * (DistributionService) and the Proof-of-Play block-mining job
 * (BlockMiningService), both driven by @scadium/worker, plus the public read
 * endpoints. PrismaModule is global, so no imports are needed.
 */
@Module({
  controllers: [EngineController],
  providers: [DistributionService, BlockMiningService],
  exports: [DistributionService, BlockMiningService],
})
export class EngineModule {}
