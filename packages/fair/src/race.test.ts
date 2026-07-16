import { describe, it, expect } from 'vitest';
import { RACE, racePrizeLamports, LAMPORTS_PER_SOL } from '@scadium/shared';

const SOL = BigInt(LAMPORTS_PER_SOL);

describe('daily race prize curve', () => {
  it('payout weights sum to exactly 10000 bps (the whole pool, nothing over)', () => {
    const sum = RACE.PAYOUT_BPS.reduce((a, b) => a + b, 0);
    expect(sum).toBe(10_000);
  });

  it('racePrizeLamports pays each rank its bps share of the fixed pool', () => {
    // Pool = 50 SOL. Rank 1 = 30% = 15 SOL, rank 2 = 20% = 10 SOL, rank 3 = 14% = 7 SOL.
    expect(racePrizeLamports(0)).toBe(15n * SOL);
    expect(racePrizeLamports(1)).toBe(10n * SOL);
    expect(racePrizeLamports(2)).toBe(7n * SOL);
    // Last paid rank (index 9) = 200 bps = 2% = 1 SOL.
    expect(racePrizeLamports(RACE.PAYOUT_BPS.length - 1)).toBe(1n * SOL);
  });

  it('ranks beyond the payout curve win nothing', () => {
    expect(racePrizeLamports(RACE.PAYOUT_BPS.length)).toBe(0n);
    expect(racePrizeLamports(999)).toBe(0n);
  });

  it('the sum of all prizes never exceeds the pool', () => {
    let total = 0n;
    for (let i = 0; i < RACE.PAYOUT_BPS.length; i += 1) total += racePrizeLamports(i);
    expect(total).toBeLessThanOrEqual(BigInt(RACE.DAILY_POOL_LAMPORTS));
    expect(total).toBe(BigInt(RACE.DAILY_POOL_LAMPORTS)); // curve sums to 100%
  });
});
