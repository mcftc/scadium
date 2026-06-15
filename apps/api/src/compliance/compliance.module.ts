import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { GeoService } from './geo.service';
import { VpnDetectionService } from './vpn-detection.service';
import { GeoGuard } from './geo.guard';

@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, GeoService, VpnDetectionService, GeoGuard],
  exports: [ComplianceService, GeoService, VpnDetectionService, GeoGuard],
})
export class ComplianceModule {}
