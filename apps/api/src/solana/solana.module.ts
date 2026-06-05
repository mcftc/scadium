import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChainService } from './chain.service';
import { VaultController } from './vault.controller';

/**
 * Global so game engines (crash/coinflip/...) can inject ChainService for
 * settlement receipts without importing the module everywhere.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [VaultController],
  providers: [ChainService],
  exports: [ChainService],
})
export class SolanaModule {}
