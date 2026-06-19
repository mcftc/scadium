import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Keypair } from '@solana/web3.js';
import { ChainService } from '../src/solana/chain.service';
import {
  COSIGNER_PROVIDER,
  createCosignerProvider,
  type CosignerKeyProvider,
} from '../src/solana/cosigner-key.provider';

/**
 * #36 cosigner-rotation integration: the key is rotated THROUGH `ChainService`
 * (`reloadCosigner()` → the custody provider re-reads its source) so the next
 * signed tx uses the new public key WITHOUT a process restart. The provider-unit
 * spec (`cosigner-provider.spec.ts`) covers `reload()` in isolation; this asserts
 * the rotation is observable on the service every privileged tx path derives its
 * cosigner from.
 *
 * No DB/RPC: ChainService is constructed directly with a stub ConfigService and a
 * real FileCosignerProvider over a temp keypair file (the dev custody path).
 */

/** Minimal ConfigService stub returning a fixed env map. */
function configStub(map: Record<string, string>): never {
  return { get: (k: string) => map[k] } as never;
}

/** Write `kp` to `path` as the JSON secret-key array (the file provider's format). */
function writeKp(path: string, kp: Keypair): void {
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
}

function makeChain(provider: CosignerKeyProvider): ChainService {
  // A valid program id so onModuleInit can enable (any base58 pubkey works).
  const programId = Keypair.generate().publicKey.toBase58();
  const chain = new ChainService(
    configStub({ VAULT_PROGRAM_ID: programId, SOLANA_RPC_URL: 'http://localhost:8899' }),
    provider,
  );
  // DI token reference kept meaningful (the real module binds the provider here).
  void COSIGNER_PROVIDER;
  chain.onModuleInit();
  return chain;
}

describe('cosigner rotation through ChainService (#36)', () => {
  it('reloadCosigner() picks up a rotated key — next tx uses the new pubkey, no restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scad-rot-'));
    const path = join(dir, 'cosigner.json');
    const kpA = Keypair.generate();
    writeKp(path, kpA);

    const provider = createCosignerProvider({ keypairPath: path, isProduction: false });
    const chain = makeChain(provider);

    // Initial key in force + on-chain settlement enabled.
    expect(chain.enabled).toBe(true);
    expect(chain.cosignerPublicKey?.toBase58()).toBe(kpA.publicKey.toBase58());

    // Rotate: overwrite the same path with a NEW key, then reload (no restart).
    const kpB = Keypair.generate();
    writeKp(path, kpB);
    const reported = chain.reloadCosigner();

    expect(reported).toBe(kpB.publicKey.toBase58());
    expect(chain.cosignerPublicKey?.toBase58()).toBe(kpB.publicKey.toBase58());
    expect(chain.cosignerPublicKey?.toBase58()).not.toBe(kpA.publicKey.toBase58());
    // Still enabled — rotation must not require a redeploy / re-init.
    expect(chain.enabled).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('rotating to an unreadable key fails CLOSED — cosigner unavailable, settlement disabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scad-rot-'));
    const path = join(dir, 'cosigner.json');
    writeKp(path, Keypair.generate());

    const provider = createCosignerProvider({ keypairPath: path, isProduction: false });
    const chain = makeChain(provider);
    expect(chain.enabled).toBe(true);

    // Corrupt the key source, then rotate: the service must disable, not crash.
    writeFileSync(path, 'not-json');
    const reported = chain.reloadCosigner();

    expect(reported).toBeNull();
    expect(chain.cosignerPublicKey).toBeNull();
    expect(chain.enabled).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});
