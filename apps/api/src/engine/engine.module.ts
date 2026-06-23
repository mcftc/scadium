import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EngineController } from './engine.controller';
import { DistributionService } from './distribution.service';
import { BlockMiningService } from './block-mining.service';

/**
 * SCAD Engine module — owns the hourly GGR→USDS distribution job
 * (DistributionService) and the Proof-of-Play block-mining job
 * (BlockMiningService), both driven by @scadium/worker, plus the read endpoints.
 * PrismaModule is global; AuthModule is imported for the `JwtAuthGuard` on the
 * authed `/engine/me` route.
 */
@Module({
  imports: [AuthModule],
  controllers: [EngineController],
  providers: [DistributionService, BlockMiningService],
  exports: [DistributionService, BlockMiningService],
})
export class EngineModule {}
