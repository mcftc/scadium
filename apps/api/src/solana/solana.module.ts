import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChainService } from './chain.service';
import { VaultController } from './vault.controller';
import { VaultBridgeService } from './vault-bridge.service';

/**
 * Global so game engines (crash/coinflip/...) can inject ChainService for
 * settlement receipts without importing the module everywhere.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [VaultController],
  providers: [ChainService, VaultBridgeService],
  exports: [ChainService, VaultBridgeService],
})
export class SolanaModule {}
