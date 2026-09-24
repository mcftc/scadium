import { Global, Module } from '@nestjs/common';
import { resolveNetworkConfig } from '@scadium/shared';
import { AuthModule } from '../auth/auth.module';
import { custodyConfig } from './custody.config';
import { Web3CustodyChain } from './custody-chain';
import { CUSTODY_CHAIN, CustodyRuntime } from './custody-runtime';
import { DepositService } from './deposit.service';
import { WithdrawalService } from './withdrawal.service';
import { CustodyController } from './custody.controller';

/**
 * Custody (ADR 0005): deposits to and withdrawals from the hot wallet. Global so
 * the job registry and reconciliation resolve it from both the API and the
 * worker graph. The chain seam is a provider so the integration suite can swap
 * in an in-memory ledger. (The play/real economy rules are plain functions in
 * `economy.ts`.)
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [CustodyController],
  providers: [
    {
      provide: CUSTODY_CHAIN,
      useFactory: () =>
        new Web3CustodyChain(
          resolveNetworkConfig(process.env.SOLANA_NETWORK, process.env.SOLANA_RPC_URL).rpcUrl,
          custodyConfig().commitment,
        ),
    },
    CustodyRuntime,
    DepositService,
    WithdrawalService,
  ],
  exports: [CustodyRuntime, DepositService, WithdrawalService],
})
export class CustodyModule {}
