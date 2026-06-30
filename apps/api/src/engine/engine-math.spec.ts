import {
  ENGINE,
  JETON,
  USDS,
  lamportsToUsdsBase,
  dividendPoolUsdsBase,
  buybackBudgetLamports,
} from '@scadium/shared';
import { describe, expect, it } from 'vitest';
import { estimateApyPct } from '../staking/staking.service';

/**
 * SCAD Engine money math (T1): NGR→USDS conversion, the dividend/buyback bps
 * slices, and the indicative APY. All BigInt-safe; no float drift on money.
 */
describe('engine money math', () => {
  it('converts lamports to USDS base units at the fixed Jeton rate', () => {
    // $1 of Jeton = JETON.LAMPORTS_PER_USD lamports → 1 USDS = USDS.BASE_PER_USD.
    expect(lamportsToUsdsBase(BigInt(JETON.LAMPORTS_PER_USD))).toBe(BigInt(USDS.BASE_PER_USD));
    // $100 worth.
    expect(lamportsToUsdsBase(BigInt(JETON.LAMPORTS_PER_USD) * 100n)).toBe(
      BigInt(USDS.BASE_PER_USD) * 100n,
    );
    expect(lamportsToUsdsBase(0n)).toBe(0n);
    expect(lamportsToUsdsBase(-5n)).toBe(0n);
  });

  it('takes DIVIDEND_NGR_BPS of NGR into the USDS pool', () => {
    // 100 "USD" of NGR → DIVIDEND_NGR_BPS (12%) = $12 → 12 * BASE_PER_USD USDS.
    const ngr = BigInt(JETON.LAMPORTS_PER_USD) * 100n;
    const expectedUsd = (100 * ENGINE.DIVIDEND_NGR_BPS) / 10_000; // 12
    expect(dividendPoolUsdsBase(ngr)).toBe(BigInt(expectedUsd * USDS.BASE_PER_USD));
    expect(dividendPoolUsdsBase(0n)).toBe(0n);
  });

  it('buy-and-burn is REMOVED: BUYBACK_NGR_BPS = 0, burn budget is always 0', () => {
    const ngr = 1_000_000_000n; // 1 SOL-equivalent lamports
    expect(ENGINE.BUYBACK_NGR_BPS).toBe(0);
    expect(buybackBudgetLamports(ngr)).toBe(0n);
    expect(buybackBudgetLamports(ngr)).toBe((ngr * BigInt(ENGINE.BUYBACK_NGR_BPS)) / 10_000n);
  });

  it('estimates APY from the last round (0 when no stake)', () => {
    expect(estimateApyPct(null)).toBe(0);
    expect(estimateApyPct({ poolUsds: 100n, totalStakedSnapshot: 0n })).toBe(0);
    // poolUsds == staked → per-round yield 1 → ×(hours/year) ×100.
    const roundsPerYear = (365 * 24 * 60 * 60 * 1000) / ENGINE.DISTRIBUTION_INTERVAL_MS;
    expect(estimateApyPct({ poolUsds: 10n, totalStakedSnapshot: 10n })).toBe(
      Math.round(roundsPerYear * 100 * 100) / 100,
    );
  });
});
