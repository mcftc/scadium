import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';

/**
 * Phase G reconciliation. PrismaModule is @Global, so the service gets
 * PrismaService without an explicit import. Exported so admin endpoints (and a
 * future Phase H worker) can read drift / trigger a run.
 */
@Module({
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
