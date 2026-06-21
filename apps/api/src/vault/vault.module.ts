import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultAccrualService } from './vault-accrual.service';

/**
 * SCAD Vault — term-staking module. Ships the deposit/withdraw service (V4) and
 * the hourly yield-accrual service (V5, run by @scadium/worker). The controller
 * + gateway land in V6. PrismaModule is global, so the services resolve
 * PrismaService without an explicit import here.
 */
@Module({
  providers: [VaultService, VaultAccrualService],
  exports: [VaultService, VaultAccrualService],
})
export class VaultModule {}
