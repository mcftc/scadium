import { describe, expect, it } from 'vitest';
import { resolveNetworkConfig, SOLANA_NETWORKS } from '@scadium/shared';
import { SiwsService } from '../auth/siws.service';

/**
 * #185 (sliced from #53) — fail-closed network/RPC resolution.
 *
 * The property under test is money-safety: the old code defaulted the RPC to a
 * fixed `https://api.devnet.solana.com` string INDEPENDENT of the selected
 * network, so `SOLANA_NETWORK=mainnet` with no RPC set silently talked to devnet
 * while the app believed it was on mainnet. These assertions prove that footgun
 * is gone (mainnet never resolves to a devnet URL — and, since mainnet has no
 * public default, fails closed unless an explicit RPC is given), that a typo'd
 * network never silently falls back, and that the historical dev/beta default
 * (`devnet` when unset) is preserved so the play-money beta + CI prod builds keep
 * working. The fail-closed signal is SELECTING MAINNET, never `NODE_ENV` — the
 * beta runs in prod mode and must still default to devnet.
 */
describe('resolveNetworkConfig (#185)', () => {
  const DEVNET_RPC = 'https://api.devnet.solana.com';

  it('mainnet + no RPC fails closed — never silently a devnet URL (the core bug)', () => {
    // The old code returned the devnet RPC here; now mainnet demands an explicit RPC.
    expect(() => resolveNetworkConfig('mainnet', undefined)).toThrow(/explicit RPC|mainnet/i);
    expect(() => resolveNetworkConfig('mainnet-beta', undefined)).toThrow(/explicit RPC|mainnet/i);
  });

  it('mainnet + explicit RPC is used verbatim and never coerced to devnet', () => {
    const cfg = resolveNetworkConfig('mainnet', 'https://my.dedicated.rpc');
    expect(cfg.network).toBe('mainnet-beta'); // `mainnet` alias normalized
    expect(cfg.rpcUrl).toBe('https://my.dedicated.rpc');
    expect(cfg.rpcUrl).not.toContain('devnet');
  });

  it('network unset → devnet default preserved (play-money beta + prod CI build unchanged)', () => {
    const cfg = resolveNetworkConfig(undefined, undefined);
    expect(cfg.network).toBe('devnet');
    expect(cfg.rpcUrl).toBe(DEVNET_RPC);
    // Blank/whitespace is treated as unset, not an error.
    expect(resolveNetworkConfig('  ', undefined).network).toBe('devnet');
  });

  it('an invalid/typo network throws rather than silently falling back to devnet', () => {
    expect(() => resolveNetworkConfig('mainet', undefined)).toThrow(/invalid/i);
    expect(() => resolveNetworkConfig('garbage', 'https://x')).toThrow(/invalid/i);
  });

  it('devnet/testnet/localnet derive their own public RPC when none is set', () => {
    expect(resolveNetworkConfig('devnet', undefined).rpcUrl).toBe(DEVNET_RPC);
    expect(resolveNetworkConfig('testnet', undefined).rpcUrl).toBe(
      'https://api.testnet.solana.com',
    );
    expect(resolveNetworkConfig('localnet', undefined).rpcUrl).toBe('http://127.0.0.1:8899');
  });

  it('an explicitly-set RPC is used verbatim for any cluster', () => {
    expect(resolveNetworkConfig('devnet', 'https://my.rpc').rpcUrl).toBe('https://my.rpc');
  });

  it('SOLANA_NETWORKS enumerates the supported clusters', () => {
    expect(SOLANA_NETWORKS).toContain('mainnet-beta');
    expect(SOLANA_NETWORKS).toContain('devnet');
  });
});

describe('SiwsService.binding chainId is bound to the resolved network (#185)', () => {
  it('flips the chainId with SOLANA_NETWORK (mainnet → solana:mainnet-beta)', () => {
    expect(
      SiwsService.binding({ SOLANA_NETWORK: 'mainnet', SOLANA_RPC_URL: 'https://x' }).chainId,
    ).toBe('solana:mainnet-beta');
    expect(SiwsService.binding({ SOLANA_NETWORK: 'devnet' }).chainId).toBe('solana:devnet');
  });

  it('unset network binds to devnet (beta default), even in prod mode', () => {
    expect(SiwsService.binding({ NODE_ENV: 'production' }).chainId).toBe('solana:devnet');
  });

  it('a typo network fails closed rather than binding to the wrong cluster', () => {
    expect(() => SiwsService.binding({ SOLANA_NETWORK: 'mainet' })).toThrow(/invalid/i);
  });
});
