import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ChainService } from './chain.service';
import type { CosignerKeyProvider } from './cosigner-key.provider';

const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

class FakeProvider implements CosignerKeyProvider {
  readonly kind = 'fake';
  constructor(private kp: Keypair | null) {}
  get publicKey(): PublicKey | null {
    return this.kp?.publicKey ?? null;
  }
  get signer(): Keypair | null {
    return this.kp;
  }
  get available(): boolean {
    return this.kp !== null;
  }
  reload(): void {}
}

/**
 * SCAD Vault chain bridge (V10): the server-driveable on-chain ops must be inert
 * while the chain is disabled (play-money) — `vault_deposit`/`withdraw` are
 * user-signed and never server-driven, so the bridge only exposes the
 * cosigner-signed accrual and a reconciliation read, both gated by `enabled`.
 */
describe('ChainService — vault bridge (V10)', () => {
  it('vaultAccrue returns null while the chain is disabled', async () => {
    const chain = new ChainService(cfg({}), new FakeProvider(Keypair.generate()));
    expect(chain.enabled).toBe(false);
    expect(await chain.vaultAccrue({ termDays: 30, amountScadBase: 1_000_000_000n })).toBeNull();
  });

  it('readVaultPoolOnChain returns null while the chain is disabled', async () => {
    const chain = new ChainService(cfg({}), new FakeProvider(Keypair.generate()));
    expect(await chain.readVaultPoolOnChain(30)).toBeNull();
  });
});
