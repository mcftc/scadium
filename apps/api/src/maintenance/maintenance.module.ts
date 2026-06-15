import { Global, Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { StatusController } from './status.controller';

// Global so RgService (the shared wager gate) and the deposit path can read the
// pause flag without re-importing (#56).
@Global()
@Module({
  controllers: [StatusController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
