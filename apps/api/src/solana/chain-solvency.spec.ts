import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ChainService } from './chain.service';
import type { CosignerKeyProvider } from './cosigner-key.provider';
import { treasuryPayoutBlockedTotal } from '../observability/metrics.registry';

const cfg = (env: Record<string, string | undefined> = {}) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

/** Provider with a real keypair so ChainService's cosigner guard passes. */
class KeyProvider implements CosignerKeyProvider {
  readonly kind = 'file';
  constructor(private kp = Keypair.generate()) {}
  get publicKey(): PublicKey {
    return this.kp.publicKey;
  }
  get signer(): Keypair {
    return this.kp;
  }
  get available(): boolean {
    return true;
  }
  reload(): void {}
}

const SOL = 1_000_000_000n;

async function blockedCount(): Promise<number> {
  const m = await treasuryPayoutBlockedTotal.get();
  return m.values.filter((v) => v.labels.kind === 'settle').reduce((s, v) => s + v.value, 0);
}

describe('ChainService pre-payout solvency guard (#54)', () => {
  it('refuses a winning settle that would breach the reserve floor + increments the counter', async () => {
    const chain = new ChainService(cfg(), new KeyProvider());
    chain.enabled = true;
    // House holds only 2 SOL; a 9-SOL net payout would breach the floor.
    (chain as unknown as { houseVaultBalance: () => Promise<bigint> }).houseVaultBalance =
      async () => 2n * SOL;

    const before = await blockedCount();
    const sig = await chain.settleBet({
      betId: '11111111-1111-1111-1111-111111111111',
      walletAddress: Keypair.generate().publicKey.toBase58(),
      game: 'crash',
      stakeLamports: 1n * SOL,
      payoutLamports: 10n * SOL, // net house pays 9 SOL
      multiplier: 10,
    });

    expect(sig).toBeNull(); // refused BEFORE building/sending the tx
    expect(await blockedCount()).toBe(before + 1);
  });

  it('reserveFloorLamports = rent floor + bankroll buffer', () => {
    const chain = new ChainService(cfg(), new KeyProvider());
    // 890_880 rent + 1 SOL buffer (HOUSE.MIN_BANKROLL_BUFFER_LAMPORTS).
    expect(chain.reserveFloorLamports).toBe(890_880n + SOL);
  });
});
