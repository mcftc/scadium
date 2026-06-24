import { describe, expect, it } from 'vitest';
import { VAULT, type VaultStrategy } from '@scadium/shared';
import { VaultStrategyService } from './vault-strategy.service';

/**
 * VaultStrategyService (Faz 3 V11/V12 off-chain skeleton). Covers the pure
 * invest/divest/harvest planning and the fail-safe that the executors no-op
 * while the chain layer is disabled (the live state today).
 */

const { BUFFER_BPS, BUFFER_FLOOR_BPS, MAX_INVESTED_BPS } = VAULT.STRATEGY;

describe('VaultStrategyService.planRebalance', () => {
  const pool = (over: Partial<{
    strategy: VaultStrategy;
    totalAssets: bigint;
    liquid: bigint;
    invested: bigint;
  }>) => ({
    strategy: 'jito_stake' as VaultStrategy,
    totalAssets: 1_000_000_000_000n, // 1000 SOL-ish
    liquid: 1_000_000_000_000n,
    invested: 0n,
    ...over,
  });

  it('holds when the pool has no strategy', () => {
    expect(VaultStrategyService.planRebalance(pool({ strategy: 'none' }))).toEqual({ action: 'none' });
  });

  it('invests the liquid above the buffer target (capped at MAX_INVESTED_BPS)', () => {
    const p = pool({});
    const r = VaultStrategyService.planRebalance(p);
    expect(r.action).toBe('invest');
    // cap = 85% of total; with 0 invested the cap binds before the raw excess
    if (r.action === 'invest') {
      expect(r.amount).toBe((p.totalAssets * BigInt(MAX_INVESTED_BPS)) / 10_000n);
    }
  });

  it('holds when liquid is within the buffer band (no churn)', () => {
    // liquid exactly at the buffer target, fully invested otherwise → nothing to do
    const target = (1_000_000_000_000n * BigInt(BUFFER_BPS)) / 10_000n;
    const r = VaultStrategyService.planRebalance(
      pool({ liquid: target, invested: 1_000_000_000_000n - target }),
    );
    expect(r).toEqual({ action: 'none' });
  });

  it('divests to refill the buffer when liquid drops below the floor', () => {
    const total = 1_000_000_000_000n;
    const floor = (total * BigInt(BUFFER_FLOOR_BPS)) / 10_000n;
    const target = (total * BigInt(BUFFER_BPS)) / 10_000n;
    const liquid = floor - 1n; // just under the floor
    const r = VaultStrategyService.planRebalance(
      pool({ totalAssets: total, liquid, invested: total - liquid }),
    );
    expect(r.action).toBe('divest');
    if (r.action === 'divest') expect(r.amount).toBe(target - liquid);
  });

  it('ignores dust below MIN_INVEST_BASE rather than churning', () => {
    const total = 1_000_000_000_000n;
    const target = (total * BigInt(BUFFER_BPS)) / 10_000n;
    // only a few lamports above the buffer → below MIN_INVEST_BASE → hold
    const r = VaultStrategyService.planRebalance(
      pool({ totalAssets: total, liquid: target + 100n, invested: total - target - 100n }),
    );
    expect(r).toEqual({ action: 'none' });
  });
});

describe('VaultStrategyService.planHarvest', () => {
  it('credits only the gain above cost basis', () => {
    expect(VaultStrategyService.planHarvest({ strategyValue: 1_050n, invested: 1_000n })).toEqual({
      yieldAssets: 50n,
    });
  });
  it('credits nothing when flat or down', () => {
    expect(VaultStrategyService.planHarvest({ strategyValue: 1_000n, invested: 1_000n }).yieldAssets).toBe(0n);
    expect(VaultStrategyService.planHarvest({ strategyValue: 900n, invested: 1_000n }).yieldAssets).toBe(0n);
  });
});

describe('VaultStrategyService executors (chain disabled)', () => {
  // ChainService stub with enabled=false — the live play-money state.
  const disabledChain = { enabled: false } as unknown as import('../solana/chain.service').ChainService;
  const svc = new VaultStrategyService(disabledChain);

  it('rebalance computes the plan but performs no tx while disabled', async () => {
    const r = await svc.rebalance({
      termDays: 90,
      strategy: 'jito_stake',
      totalAssets: 1_000_000_000_000n,
      liquid: 1_000_000_000_000n,
      invested: 0n,
    });
    expect(r.action).toBe('invest');
    expect(r.txSig).toBeNull(); // no on-chain call
  });

  it('harvest and strategyDrift are no-ops while disabled', async () => {
    expect(await svc.harvest(90)).toEqual({ yieldAssets: 0n, txSig: null });
    expect(await svc.strategyDrift({ termDays: 90, totalAssets: 1n, liquid: 1n })).toBeNull();
  });
});
