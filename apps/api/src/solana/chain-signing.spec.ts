import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ChainService } from './chain.service';
import type { CosignerKeyProvider } from './cosigner-key.provider';

const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

/** Fake provider whose key (and availability) we control to drive ChainService. */
class FakeProvider implements CosignerKeyProvider {
  readonly kind = 'fake';
  reloadCount = 0;
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
  /** Test hook: simulate a rotation that swaps the underlying key. */
  rotateTo(kp: Keypair | null) {
    this.kp = kp;
  }
  reload(): void {
    this.reloadCount++;
  }
}

describe('ChainService cosigner via provider (#36)', () => {
  it('sources the cosigner public key from the injected provider', () => {
    const kp = Keypair.generate();
    const chain = new ChainService(cfg({}), new FakeProvider(kp));
    expect(chain.cosignerPublicKey?.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it('reports no cosigner public key when the provider is unavailable', () => {
    const chain = new ChainService(cfg({}), new FakeProvider(null));
    expect(chain.cosignerPublicKey).toBeNull();
  });

  it('reloadCosigner() rotates the key through the provider without a restart', () => {
    const kpA = Keypair.generate();
    const provider = new FakeProvider(kpA);
    const chain = new ChainService(cfg({ VAULT_PROGRAM_ID: kpA.publicKey.toBase58() }), provider);
    // Simulate boot: programId set + cosigner available → enabled.
    chain.onModuleInit();
    expect(chain.enabled).toBe(true);
    expect(chain.cosignerPublicKey?.toBase58()).toBe(kpA.publicKey.toBase58());

    // Rotate to a new key and reload — the new pubkey is reported, no restart.
    const kpB = Keypair.generate();
    provider.rotateTo(kpB);
    const reported = chain.reloadCosigner();
    expect(provider.reloadCount).toBe(1);
    expect(reported).toBe(kpB.publicKey.toBase58());
    expect(chain.cosignerPublicKey?.toBase58()).toBe(kpB.publicKey.toBase58());
  });

  it('reloadCosigner() disables settlement if the rotated key becomes unavailable', () => {
    const kp = Keypair.generate();
    const provider = new FakeProvider(kp);
    const chain = new ChainService(cfg({ VAULT_PROGRAM_ID: kp.publicKey.toBase58() }), provider);
    chain.onModuleInit();
    expect(chain.enabled).toBe(true);

    provider.rotateTo(null); // key revoked / load failed
    chain.reloadCosigner();
    expect(chain.enabled).toBe(false);
  });
});
