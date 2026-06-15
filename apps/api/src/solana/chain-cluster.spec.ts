import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ChainService } from './chain.service';

const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

describe('ChainService.cluster (#53)', () => {
  it('defaults to devnet when SOLANA_NETWORK is unset', () => {
    expect(new ChainService(cfg({})).cluster).toBe('devnet');
  });

  it('reflects a configured SOLANA_NETWORK (e.g. mainnet-beta)', () => {
    expect(new ChainService(cfg({ SOLANA_NETWORK: 'mainnet-beta' })).cluster).toBe('mainnet-beta');
  });

  it('trims whitespace and falls back to devnet on blank', () => {
    expect(new ChainService(cfg({ SOLANA_NETWORK: '  ' })).cluster).toBe('devnet');
  });
});
