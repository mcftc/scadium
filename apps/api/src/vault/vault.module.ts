import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { VaultAccrualService } from './vault-accrual.service';
import { VaultStrategyService } from './vault-strategy.service';

/**
 * SCAD Vault — term-staking module. Ships the deposit/withdraw service (V4), the
 * hourly yield-accrual service (V5, run by @scadium/worker), the REST API (V6),
 * and the Faz-3 strategy manager (V11/V12, off-chain skeleton — no-op until the
 * vault DeFi CPIs deploy). AuthModule provides JwtAuthGuard for the controller.
 * PrismaModule is global, so the services resolve PrismaService without an
 * explicit import; ChainService is global via the @Global SolanaModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [VaultController],
  providers: [VaultService, VaultAccrualService, VaultStrategyService],
  exports: [VaultService, VaultAccrualService, VaultStrategyService],
})
export class VaultModule {}
