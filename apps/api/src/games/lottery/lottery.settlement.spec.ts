import { describe, it, expect } from 'vitest';
import { LOTTERY } from '@scadium/shared';
import { splitBracketPrizes } from './lottery.settlement';

const SCAD = (n: bigint) => n * 10n ** 9n;

describe('splitBracketPrizes (PancakeSwap pool settlement)', () => {
  it('burns 20% off the top and splits the rest by the breakdown', () => {
    const pool = SCAD(1_000n);
    const { burn, bracketSlices } = splitBracketPrizes(pool, [0, 0, 0, 0, 0, 0]);
    expect(burn).toBe((pool * 2000n) / 10_000n); // 200 SCAD
    const toWinners = pool - burn;
    LOTTERY.REWARDS_BREAKDOWN_BPS.forEach((bps, i) => {
      expect(bracketSlices[i]).toBe((toWinners * BigInt(bps)) / 10_000n);
    });
  });

  it('with no winners anywhere, the entire winner-share rolls forward', () => {
    const pool = SCAD(1_000n);
    const { burn, nextRollover } = splitBracketPrizes(pool, [0, 0, 0, 0, 0, 0]);
    expect(nextRollover).toBe(pool - burn); // 800 SCAD carried forward
  });

  it('splits a bracket slice EQUALLY among its winners; dust rolls forward', () => {
    const pool = SCAD(1_000n);
    const counts = [0, 0, 0, 0, 0, 3]; // 3 jackpot winners
    const { bracketSlices, perWinner, bracketRollover } = splitBracketPrizes(pool, counts);
    const jackpotSlice = bracketSlices[5]!;
    expect(perWinner[5]).toBe(jackpotSlice / 3n);
    expect(bracketRollover[5]).toBe(jackpotSlice - (jackpotSlice / 3n) * 3n); // floor dust
    // Brackets 0..4 had no winners → their slices roll forward in full.
    for (let b = 0; b < 5; b++) expect(bracketRollover[b]).toBe(bracketSlices[b]);
  });

  it('conserves value: burn + paid + nextRollover === pool', () => {
    const pool = SCAD(777n) + 123_456_789n; // deliberately not round
    const counts = [10, 4, 2, 1, 0, 1];
    const { burn, perWinner, nextRollover } = splitBracketPrizes(pool, counts);
    const paid = perWinner.reduce((acc, p, b) => acc + p * BigInt(counts[b]!), 0n);
    // nextRollover carries every unallocated unit (unwon slices, per-winner
    // dust, and the pool-split residual), so nothing is lost.
    expect(burn + paid + nextRollover).toBe(pool);
  });

  it('rollover compounds across rounds (PancakeSwap auto-injection)', () => {
    const r1 = splitBracketPrizes(SCAD(1_000n), [0, 0, 0, 0, 0, 0]);
    const pool2 = SCAD(1_000n) + r1.nextRollover;
    const r2 = splitBracketPrizes(pool2, [0, 0, 0, 0, 0, 1]);
    expect(r2.perWinner[5]).toBe(r2.bracketSlices[5]);
    expect(r2.bracketSlices[5]!).toBeGreaterThan(r1.bracketSlices[5]!); // pool grew
  });
});
