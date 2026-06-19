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
 * is gone (mainnet never resolves to a devnet URL), that production fails closed
 * on an unset/under-specified network, and that the historical dev/beta default
 * is preserved (no play-money regression).
 */
describe('resolveNetworkConfig (#185)', () => {
  const DEVNET_RPC = 'https://api.devnet.solana.com';
  const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

  it('mainnet + unset RPC (dev) derives the MAINNET rpc, never a devnet URL — the core bug', () => {
    const cfg = resolveNetworkConfig('mainnet', undefined, false);
    expect(cfg.network).toBe('mainnet-beta');
    expect(cfg.rpcUrl).toBe(MAINNET_RPC);
    // The regression guard: a mainnet selection must NEVER silently yield devnet.
    expect(cfg.rpcUrl).not.toContain('devnet');
  });

  it('normalizes the "mainnet" alias to "mainnet-beta"', () => {
    expect(resolveNetworkConfig('mainnet', undefined, false).network).toBe('mainnet-beta');
    expect(resolveNetworkConfig('mainnet-beta', undefined, false).network).toBe('mainnet-beta');
  });

  it('mainnet + unset RPC in PRODUCTION fails closed (never guesses a mainnet RPC)', () => {
    expect(() => resolveNetworkConfig('mainnet-beta', undefined, true)).toThrow(/mainnet/i);
  });

  it('network unset in PRODUCTION fails closed (no devnet default)', () => {
    expect(() => resolveNetworkConfig(undefined, undefined, true)).toThrow(/not set|explicit/i);
    expect(() => resolveNetworkConfig('', undefined, true)).toThrow();
  });

  it('network unset in dev/beta preserves the historical devnet default (no regression)', () => {
    const cfg = resolveNetworkConfig(undefined, undefined, false);
    expect(cfg.network).toBe('devnet');
    expect(cfg.rpcUrl).toBe(DEVNET_RPC);
  });

  it('an explicitly-set RPC is used verbatim (even in production)', () => {
    const cfg = resolveNetworkConfig('mainnet-beta', 'https://my.dedicated.rpc', true);
    expect(cfg.network).toBe('mainnet-beta');
    expect(cfg.rpcUrl).toBe('https://my.dedicated.rpc');
  });

  it('an invalid/typo network throws rather than silently falling back to devnet', () => {
    expect(() => resolveNetworkConfig('mainet', undefined, false)).toThrow(/invalid/i);
    expect(() => resolveNetworkConfig('garbage', undefined, true)).toThrow(/invalid/i);
  });

  it('devnet/testnet derive their own public RPC when none is set', () => {
    expect(resolveNetworkConfig('devnet', undefined, false).rpcUrl).toBe(DEVNET_RPC);
    expect(resolveNetworkConfig('testnet', undefined, false).rpcUrl).toBe(
      'https://api.testnet.solana.com',
    );
  });

  it('SOLANA_NETWORKS enumerates the supported clusters', () => {
    expect(SOLANA_NETWORKS).toContain('mainnet-beta');
    expect(SOLANA_NETWORKS).toContain('devnet');
  });
});

describe('SiwsService.binding chainId is bound to the resolved network (#185)', () => {
  it('flips the chainId with SOLANA_NETWORK (mainnet → solana:mainnet-beta)', () => {
    expect(SiwsService.binding({ SOLANA_NETWORK: 'mainnet' }).chainId).toBe('solana:mainnet-beta');
    expect(SiwsService.binding({ SOLANA_NETWORK: 'devnet' }).chainId).toBe('solana:devnet');
  });

  it('fails closed in production for an unset network rather than binding to devnet', () => {
    expect(() => SiwsService.binding({ NODE_ENV: 'production' })).toThrow();
  });
});
