import { describe, expect, it } from 'vitest';
import {
  lotteryDraw,
  lotteryMatches,
  LOTTERY_MAIN_COUNT,
  LOTTERY_MAIN_MAX,
  LOTTERY_BONUS_MAX,
} from './lottery';
import { generateClientSeed, generateServerSeed } from './seed';

describe('lottery provably-fair draw', () => {
  it('is deterministic for identical inputs', () => {
    const a = lotteryDraw('s'.repeat(64), 'client', 7);
    const b = lotteryDraw('s'.repeat(64), 'client', 7);
    expect(a).toEqual(b);
  });

  it('draws 5 distinct main numbers in 1..36 plus a bonus in 1..10', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    for (let i = 0; i < 2000; i++) {
      const { main, bonus } = lotteryDraw(serverSeed, clientSeed, i);
      expect(main).toHaveLength(LOTTERY_MAIN_COUNT);
      expect(new Set(main).size).toBe(LOTTERY_MAIN_COUNT); // distinct
      for (const n of main) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(LOTTERY_MAIN_MAX);
      }
      // ascending
      expect([...main].sort((x, y) => x - y)).toEqual(main);
      expect(bonus).toBeGreaterThanOrEqual(1);
      expect(bonus).toBeLessThanOrEqual(LOTTERY_BONUS_MAX);
    }
  });

  it('differs across nonces', () => {
    const serverSeed = 'b'.repeat(64);
    const r1 = lotteryDraw(serverSeed, 'c', 1);
    const r2 = lotteryDraw(serverSeed, 'c', 2);
    expect(r1).not.toEqual(r2);
  });

  it('counts matches correctly', () => {
    const m = lotteryMatches([1, 2, 3, 4, 5], 7, [3, 4, 5, 6, 7], 7);
    expect(m).toEqual({ matchedMain: 3, matchedBonus: 1 });
    const none = lotteryMatches([10, 20, 30, 31, 32], 1, [1, 2, 3, 4, 5], 9);
    expect(none).toEqual({ matchedMain: 0, matchedBonus: 0 });
  });
});
