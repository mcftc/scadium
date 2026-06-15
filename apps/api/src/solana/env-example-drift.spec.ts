import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards the #36 env cleanup: the dead `HOUSE_WALLET_SECRET_KEY` (read by NO
 * code) must stay gone, and the real cosigner var must be documented.
 */
describe('.env.example cosigner drift (#36)', () => {
  const envExample = readFileSync(join(process.cwd(), '../../.env.example'), 'utf8');

  it('does not reintroduce the dead HOUSE_WALLET_SECRET_KEY', () => {
    expect(envExample).not.toContain('HOUSE_WALLET_SECRET_KEY');
  });

  it('documents the cosigner custody vars', () => {
    expect(envExample).toContain('COSIGNER_KEYPAIR_PATH');
    expect(envExample).toContain('COSIGNER_KMS_KEY_ID');
  });
});
