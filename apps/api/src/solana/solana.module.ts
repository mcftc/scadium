import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ChainService } from './chain.service';
import { VaultController } from './vault.controller';
import { VaultBridgeService } from './vault-bridge.service';
import { COSIGNER_PROVIDER, createCosignerProvider } from './cosigner-key.provider';

/**
 * Global so game engines (crash/coinflip/...) can inject ChainService for
 * settlement receipts without importing the module everywhere.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [VaultController],
  providers: [
    // Cosigner custody seam (#36): production fails closed (no plaintext disk
    // key); the dev file provider is selected only outside production.
    {
      provide: COSIGNER_PROVIDER,
      useFactory: (config: ConfigService) =>
        createCosignerProvider({
          keypairPath: config.get<string>('COSIGNER_KEYPAIR_PATH'),
          kmsKeyId: config.get<string>('COSIGNER_KMS_KEY_ID'),
          // process.env is the canonical runtime truth and can't be intercepted
          // by a ConfigModule load/ignoreEnvVars change — critical for fail-closed.
          isProduction: process.env.NODE_ENV === 'production',
        }),
      inject: [ConfigService],
    },
    ChainService,
    VaultBridgeService,
  ],
  exports: [ChainService, VaultBridgeService],
})
export class SolanaModule {}
