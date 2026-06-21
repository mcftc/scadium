import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { VaultAccrualService } from './vault-accrual.service';

/**
 * SCAD Vault — term-staking module. Ships the deposit/withdraw service (V4), the
 * hourly yield-accrual service (V5, run by @scadium/worker), and the REST API
 * (V6). AuthModule provides JwtAuthGuard for the controller. PrismaModule is
 * global, so the services resolve PrismaService without an explicit import.
 */
@Module({
  imports: [AuthModule],
  controllers: [VaultController],
  providers: [VaultService, VaultAccrualService],
  exports: [VaultService, VaultAccrualService],
})
export class VaultModule {}
