import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Keypair } from '@solana/web3.js';
import {
  createCosignerProvider,
  FileCosignerProvider,
  DisabledCosignerProvider,
} from './cosigner-key.provider';

/** Write a keypair to a fresh temp file and return [path, keypair]. */
function writeKeypair(): [string, Keypair] {
  const dir = mkdtempSync(join(tmpdir(), 'scad-cosigner-'));
  const kp = Keypair.generate();
  const path = join(dir, 'cosigner.json');
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return [path, kp];
}

describe('createCosignerProvider (#36)', () => {
  it('fails CLOSED in production with only a file path — never loads the disk key', () => {
    const [path] = writeKeypair();
    const p = createCosignerProvider({ keypairPath: path, isProduction: true });
    expect(p).toBeInstanceOf(DisabledCosignerProvider);
    expect(p.available).toBe(false);
    expect(p.publicKey).toBeNull();
    expect(p.signer).toBeNull();
  });

  it('is DISABLED when a managed key is configured (managed signer not implemented)', () => {
    const [path] = writeKeypair();
    const p = createCosignerProvider({
      keypairPath: path,
      kmsKeyId: 'arn:aws:kms:...:key/abc',
      isProduction: false,
    });
    expect(p.available).toBe(false);
    expect(p.publicKey).toBeNull();
  });

  it('loads the file keypair in a non-production env', () => {
    const [path, kp] = writeKeypair();
    const p = createCosignerProvider({ keypairPath: path, isProduction: false });
    expect(p).toBeInstanceOf(FileCosignerProvider);
    expect(p.available).toBe(true);
    expect(p.publicKey?.toBase58()).toBe(kp.publicKey.toBase58());
    expect(p.signer?.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it('is disabled when nothing is configured (play-money)', () => {
    expect(createCosignerProvider({ isProduction: false }).available).toBe(false);
  });

  it('reload() picks up a rotated key without a restart', () => {
    const [path, kpA] = writeKeypair();
    const p = createCosignerProvider({ keypairPath: path, isProduction: false });
    expect(p.publicKey?.toBase58()).toBe(kpA.publicKey.toBase58());

    // Rotate: overwrite the same path with a new key, then reload.
    const kpB = Keypair.generate();
    writeFileSync(path, JSON.stringify(Array.from(kpB.secretKey)));
    p.reload();
    expect(p.publicKey?.toBase58()).toBe(kpB.publicKey.toBase58());
    expect(p.publicKey?.toBase58()).not.toBe(kpA.publicKey.toBase58());
  });

  it('a missing/invalid file leaves the provider unavailable (no crash)', () => {
    const p = new FileCosignerProvider('/no/such/cosigner.json');
    expect(p.available).toBe(false);
    expect(p.publicKey).toBeNull();
  });
});
