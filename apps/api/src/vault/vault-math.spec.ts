import {
  ENGINE,
  VAULT,
  ngrRedistributionBps,
  vaultYieldSliceLamports,
  sharesForDeposit,
  assetsForShares,
  applyAccrual,
  earlyExitPenalty,
  scadBoostTier,
  nextScadBoostTier,
  boostedAprBps,
  bufferTargetAssets,
  investableExcess,
  divestForBufferFloor,
  unwindForWithdrawal,
  minOutAfterSlippage,
  harvestableYield,
  vaultStrategyDrift,
} from '@scadium/shared';
import { describe, expect, it } from 'vitest';

/**
 * SCAD Vault money math (V1): share/index accounting, term-pool yield slice,
 * early-exit penalty, and the hard NGR-budget invariant. All BigInt-safe; the
 * pool index is share-price based (ERC-4626-style), so yield raises the index
 * and every position appreciates pro-rata with no per-user write (drift-free).
 */
describe('vault money math', () => {
  const RAY = VAULT.RAY;

  describe('NGR redistribution budget invariant (≤ 20%)', () => {
    it('Engine dividend + buyback + Vault yield stays ≤ 2000 bps', () => {
      expect(ngrRedistributionBps()).toBeLessThanOrEqual(2000);
    });

    it('matches the locked 6 / 6 / 8 split (= exactly 20%)', () => {
      expect(ENGINE.DIVIDEND_NGR_BPS).toBe(600);
      expect(ENGINE.BUYBACK_NGR_BPS).toBe(600);
      expect(VAULT.YIELD_NGR_BPS).toBe(800);
      expect(ngrRedistributionBps()).toBe(2000);
    });

    it('takes VAULT.YIELD_NGR_BPS of NGR as the yield slice', () => {
      const ngr = 1_000_000_000n; // 1 SOL-equivalent lamports
      expect(vaultYieldSliceLamports(ngr)).toBe((ngr * BigInt(VAULT.YIELD_NGR_BPS)) / 10_000n);
      expect(vaultYieldSliceLamports(ngr)).toBe((ngr * 8n) / 100n); // 8%
      expect(vaultYieldSliceLamports(0n)).toBe(0n);
      expect(vaultYieldSliceLamports(-5n)).toBe(0n);
    });
  });

  describe('share ↔ asset conversion', () => {
    it('mints 1:1 shares at genesis (index = RAY)', () => {
      const deposit = 5_000_000_000n; // 5 SCAD
      expect(sharesForDeposit(deposit, VAULT.INITIAL_INDEX_RAY)).toBe(deposit);
      expect(assetsForShares(deposit, VAULT.INITIAL_INDEX_RAY)).toBe(deposit);
    });

    it('round-trips deposit→shares→assets at an unchanged index (≈ principal, never more)', () => {
      const index = RAY * 3n; // arbitrary appreciated index
      for (const deposit of [1_000_000_000n, 7_777_777_777n, 123_456_789_012n]) {
        const shares = sharesForDeposit(deposit, index);
        const back = assetsForShares(shares, index);
        expect(back).toBeLessThanOrEqual(deposit); // rounds in the pool's favour
        // dust only — at most one index-unit of rounding.
        expect(deposit - back).toBeLessThanOrEqual(1n);
      }
    });

    it('returns 0 for non-positive inputs', () => {
      expect(sharesForDeposit(0n, RAY)).toBe(0n);
      expect(sharesForDeposit(-1n, RAY)).toBe(0n);
      expect(sharesForDeposit(100n, 0n)).toBe(0n);
      expect(assetsForShares(0n, RAY)).toBe(0n);
      expect(assetsForShares(100n, 0n)).toBe(0n);
    });
  });

  describe('accrual (index monotonicity + value conservation)', () => {
    it('raises the index by exactly yield / totalShares and credits holders', () => {
      const deposit = 100_000_000_000n; // 100 SCAD
      const shares = sharesForDeposit(deposit, VAULT.INITIAL_INDEX_RAY);
      const yieldAssets = 10_000_000_000n; // 10 SCAD yield into the pool
      const index2 = applyAccrual(VAULT.INITIAL_INDEX_RAY, shares, yieldAssets);

      expect(index2).toBeGreaterThan(VAULT.INITIAL_INDEX_RAY); // monotonic up
      // Sole staker now owns principal + (almost) all the yield.
      const value = assetsForShares(shares, index2);
      expect(value).toBeGreaterThanOrEqual(deposit + yieldAssets - 1n);
      expect(value).toBeLessThanOrEqual(deposit + yieldAssets);
    });

    it('is a no-op on an empty pool or non-positive yield', () => {
      expect(applyAccrual(RAY, 0n, 5n)).toBe(RAY);
      expect(applyAccrual(RAY, 100n, 0n)).toBe(RAY);
      expect(applyAccrual(RAY, 100n, -5n)).toBe(RAY);
    });

    it('rewards the earlier depositor: same deposit, pre- vs post-accrual', () => {
      // Alice deposits at genesis; yield accrues; Bob deposits the same amount.
      const deposit = 50_000_000_000n;
      const aliceShares = sharesForDeposit(deposit, VAULT.INITIAL_INDEX_RAY);
      const indexAfter = applyAccrual(VAULT.INITIAL_INDEX_RAY, aliceShares, 5_000_000_000n);
      const bobShares = sharesForDeposit(deposit, indexAfter);

      // Bob buys in at a higher share price → fewer shares for the same money.
      expect(bobShares).toBeLessThan(aliceShares);
      // And Alice's position is now worth strictly more than Bob's fresh one.
      expect(assetsForShares(aliceShares, indexAfter)).toBeGreaterThan(
        assetsForShares(bobShares, indexAfter),
      );
    });
  });

  describe('early-exit penalty', () => {
    it('charges EARLY_EXIT_PENALTY_BPS of withdrawn assets', () => {
      const assets = 100_000_000_000n; // 100 SCAD
      expect(earlyExitPenalty(assets)).toBe(
        (assets * BigInt(VAULT.EARLY_EXIT_PENALTY_BPS)) / 10_000n,
      );
      expect(earlyExitPenalty(assets)).toBe(assets / 10n); // 10%
    });

    it('returns 0 for non-positive input', () => {
      expect(earlyExitPenalty(0n)).toBe(0n);
      expect(earlyExitPenalty(-5n)).toBe(0n);
    });
  });

  describe('term pools', () => {
    it('defines four ascending terms with ascending yield weights', () => {
      const days = VAULT.TERMS.map((t) => t.days);
      const weights = VAULT.TERMS.map((t) => t.weightBps);
      expect(days).toEqual([30, 90, 180, 365]);
      // longer term → larger weight (higher effective APR).
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]!).toBeGreaterThan(weights[i - 1]!);
      }
    });
  });

  describe('loyalty APR boost tiers (V13)', () => {
    it('defines ascending thresholds with ascending, ≥1.00× multipliers', () => {
      const tiers = VAULT.BOOST_TIERS;
      expect(tiers[0]!.minScadBase).toBe(0n); // Base starts at zero holdings
      expect(tiers[0]!.multiplierBps).toBe(10_000); // Base = 1.00×
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i]!.minScadBase).toBeGreaterThan(tiers[i - 1]!.minScadBase);
        expect(tiers[i]!.multiplierBps).toBeGreaterThan(tiers[i - 1]!.multiplierBps);
      }
    });

    it('selects the Base tier for zero / negative holdings', () => {
      expect(scadBoostTier(0n).label).toBe('Base');
      expect(scadBoostTier(-1n).label).toBe('Base');
      expect(scadBoostTier(0n).multiplierBps).toBe(10_000);
    });

    it('selects the highest tier whose threshold is met (boundary-inclusive)', () => {
      const silver = VAULT.BOOST_TIERS.find((t) => t.label === 'Silver')!;
      // Exactly at the threshold qualifies for that tier…
      expect(scadBoostTier(silver.minScadBase).label).toBe('Silver');
      // …one base unit short stays on the tier below.
      expect(scadBoostTier(silver.minScadBase - 1n).label).toBe('Bronze');
    });

    it('caps at the top tier for very large holdings', () => {
      const top = VAULT.BOOST_TIERS[VAULT.BOOST_TIERS.length - 1]!;
      const huge = top.minScadBase * 1_000n;
      expect(scadBoostTier(huge).label).toBe(top.label);
      expect(nextScadBoostTier(huge)).toBeNull();
    });

    it('points to the next tier up while one exists', () => {
      expect(nextScadBoostTier(0n)!.label).toBe('Bronze');
      const bronze = VAULT.BOOST_TIERS.find((t) => t.label === 'Bronze')!;
      expect(nextScadBoostTier(bronze.minScadBase)!.label).toBe('Silver');
    });

    it('scales a base APR by the tier multiplier', () => {
      expect(boostedAprBps(1200, 10_000)).toBe(1200); // 1.00× is a no-op
      expect(boostedAprBps(1200, 12_500)).toBe(1500); // 12% → 15% at 1.25×
      expect(boostedAprBps(1000, 20_000)).toBe(2000); // doubles at 2.00×
      // a holder's effective APR is never below the base rate
      for (const t of VAULT.BOOST_TIERS) {
        expect(boostedAprBps(1000, t.multiplierBps)).toBeGreaterThanOrEqual(1000);
      }
    });
  });

  describe('Faz 3 strategy math (V11/V12)', () => {
    const S = VAULT.STRATEGY;

    it('locks a sane buffer/cap budget (buffer ≤ floor-complement of the cap)', () => {
      expect(S.BUFFER_FLOOR_BPS).toBeLessThanOrEqual(S.BUFFER_BPS);
      // never deploy so much that less than the buffer could remain liquid
      expect(S.MAX_INVESTED_BPS + S.BUFFER_BPS).toBeLessThanOrEqual(10_000);
      expect(S.MAX_UNWIND_SLIPPAGE_BPS).toBeLessThan(10_000);
    });

    it('bufferTargetAssets is bufferBps of total (0 for empty pool)', () => {
      expect(bufferTargetAssets(1_000_000n, 1500)).toBe(150_000n);
      expect(bufferTargetAssets(0n, 1500)).toBe(0n);
    });

    describe('investableExcess', () => {
      const base = { totalAssets: 1_000_000n, invested: 0n, bufferBps: 1500, maxInvestedBps: 8500 };
      it('deploys only the liquid above the buffer target', () => {
        // liquid 1,000,000, buffer target 150,000 → investable 850,000 (== cap)
        expect(investableExcess({ ...base, liquid: 1_000_000n })).toBe(850_000n);
      });
      it('is zero at/under the buffer target', () => {
        expect(investableExcess({ ...base, liquid: 150_000n })).toBe(0n);
        expect(investableExcess({ ...base, liquid: 100_000n })).toBe(0n);
      });
      it('respects the MAX_INVESTED_BPS cap given prior investment', () => {
        // already invested 800,000 of an 850,000 cap → only 50,000 of room left
        expect(investableExcess({ ...base, liquid: 1_000_000n, invested: 800_000n })).toBe(50_000n);
      });
      it('never invests from an empty/zero pool', () => {
        expect(investableExcess({ ...base, liquid: 0n })).toBe(0n);
        expect(investableExcess({ ...base, totalAssets: 0n, liquid: 0n })).toBe(0n);
      });
    });

    describe('divestForBufferFloor', () => {
      const base = { totalAssets: 1_000_000n, invested: 800_000n, bufferBps: 1500, floorBps: 1000 };
      it('refills to the buffer target when liquid drops below the floor', () => {
        // liquid 50,000 < floor 100,000 → pull to target 150,000 → divest 100,000
        expect(divestForBufferFloor({ ...base, liquid: 50_000n })).toBe(100_000n);
      });
      it('does nothing while liquid is at/above the floor', () => {
        expect(divestForBufferFloor({ ...base, liquid: 100_000n })).toBe(0n);
        expect(divestForBufferFloor({ ...base, liquid: 200_000n })).toBe(0n);
      });
      it('is bounded by what is actually invested', () => {
        expect(divestForBufferFloor({ ...base, liquid: 0n, invested: 40_000n })).toBe(40_000n);
      });
    });

    it('unwindForWithdrawal covers only the shortfall beyond the liquid balance', () => {
      expect(unwindForWithdrawal(300n, 100n)).toBe(200n);
      expect(unwindForWithdrawal(80n, 100n)).toBe(0n); // buffer covers it
      expect(unwindForWithdrawal(100n, 100n)).toBe(0n);
    });

    it('minOutAfterSlippage applies the slippage cap (and floors at 0)', () => {
      expect(minOutAfterSlippage(1_000_000n, 50)).toBe(995_000n); // 0.5%
      expect(minOutAfterSlippage(0n, 50)).toBe(0n);
      expect(minOutAfterSlippage(1_000n, 0)).toBe(1_000n);
    });

    it('harvestableYield is the gain above cost basis, never negative', () => {
      expect(harvestableYield(1_050n, 1_000n)).toBe(50n); // appreciated
      expect(harvestableYield(1_000n, 1_000n)).toBe(0n); // flat
      expect(harvestableYield(950n, 1_000n)).toBe(0n); // a loss is held, not minted
    });

    describe('vaultStrategyDrift', () => {
      const tol = VAULT.STRATEGY.DRIFT_TOLERANCE_BPS;
      it('is ok when total == liquid + strategyValue', () => {
        const r = vaultStrategyDrift({
          totalAssets: 1_000_000n,
          liquid: 200_000n,
          strategyValue: 800_000n,
          toleranceBps: tol,
        });
        expect(r.drift).toBe(0n);
        expect(r.ok).toBe(true);
      });
      it('flags drift beyond tolerance and reports its sign', () => {
        const r = vaultStrategyDrift({
          totalAssets: 1_000_000n,
          liquid: 200_000n,
          strategyValue: 700_000n, // 100,000 short
          toleranceBps: tol,
        });
        expect(r.drift).toBe(-100_000n);
        expect(r.ok).toBe(false);
      });
    });
  });
});
