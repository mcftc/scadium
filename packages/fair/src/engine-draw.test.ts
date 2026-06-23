import { describe, it, expect } from 'vitest';
import { weightedWinnerIndex, jackpotWinningTicket } from './index';

describe('Engine v2 — weighted big-reward draw', () => {
  it('maps a ticket to the owning cumulative range', () => {
    const weights = [30n, 70n]; // total 100
    expect(weightedWinnerIndex(0n, weights)).toBe(0);
    expect(weightedWinnerIndex(29n, weights)).toBe(0);
    expect(weightedWinnerIndex(30n, weights)).toBe(1);
    expect(weightedWinnerIndex(99n, weights)).toBe(1);
  });

  it('every participant with play-rate can win; the zero-weight one cannot', () => {
    const weights = [10n, 0n, 90n];
    // No ticket falls in the empty (index 1) range.
    for (let t = 0n; t < 100n; t += 1n) {
      expect(weightedWinnerIndex(t, weights)).not.toBe(1);
    }
    expect(weightedWinnerIndex(9n, weights)).toBe(0);
    expect(weightedWinnerIndex(10n, weights)).toBe(2);
  });

  it('empirical win frequency tracks play-rate weight (provably-fair tickets)', () => {
    // 25/75 split — over many committed seeds, wins should land ~1:3.
    const weights = [25n, 75n];
    const total = 100n;
    let zero = 0;
    const N = 2000;
    for (let n = 0; n < N; n += 1) {
      const ticket = jackpotWinningTicket('server-seed', 'engine-block', n, total);
      if (weightedWinnerIndex(ticket, weights) === 0) zero += 1;
    }
    // Expect ~25% ± 4% for index 0.
    expect(zero / N).toBeGreaterThan(0.21);
    expect(zero / N).toBeLessThan(0.29);
  });

  it('a single participant always wins', () => {
    expect(weightedWinnerIndex(0n, [42n])).toBe(0);
    expect(weightedWinnerIndex(41n, [42n])).toBe(0);
  });
});
