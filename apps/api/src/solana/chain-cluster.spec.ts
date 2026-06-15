import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ChainService } from './chain.service';
import { DisabledCosignerProvider } from './cosigner-key.provider';

const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;
const noCosigner = () => new DisabledCosignerProvider();

describe('ChainService.cluster (#53)', () => {
  it('defaults to devnet when SOLANA_NETWORK is unset', () => {
    expect(new ChainService(cfg({}), noCosigner()).cluster).toBe('devnet');
  });

  it('reflects a configured SOLANA_NETWORK (e.g. mainnet-beta)', () => {
    expect(new ChainService(cfg({ SOLANA_NETWORK: 'mainnet-beta' }), noCosigner()).cluster).toBe(
      'mainnet-beta',
    );
  });

  it('trims whitespace and falls back to devnet on blank', () => {
    expect(new ChainService(cfg({ SOLANA_NETWORK: '  ' }), noCosigner()).cluster).toBe('devnet');
  });
});
