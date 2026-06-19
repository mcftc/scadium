import { Module } from '@nestjs/common';
import { EngineController } from './engine.controller';
import { DistributionService } from './distribution.service';

/**
 * SCAD Engine module — owns the hourly GGR→USDS distribution job
 * (DistributionService, driven by @scadium/worker) and the public read
 * endpoints. PrismaModule is global, so no imports are needed.
 */
@Module({
  controllers: [EngineController],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class EngineModule {}
