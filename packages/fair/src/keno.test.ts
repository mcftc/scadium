import { describe, expect, it } from 'vitest';
import { KENO, KENO_RISKS, RTP, kenoHitProbability, kenoPaytable } from '@scadium/shared';
import { kenoDraw, kenoHits } from './keno';

describe('keno', () => {
  it('draws DRAWS distinct numbers in 1..CELLS, deterministically', () => {
    const a = kenoDraw('s', 'c', 7);
    expect(a).toEqual(kenoDraw('s', 'c', 7));
    expect(new Set(a).size).toBe(KENO.DRAWS);
    expect(a.every((n) => n >= 1 && n <= KENO.CELLS)).toBe(true);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
    expect(kenoDraw('s', 'c', 8)).not.toEqual(a);
  });

  it('counts hits', () => {
    expect(kenoHits([1, 2, 3], [2, 3, 9])).toBe(2);
  });

  it('hit probabilities sum to 1 for every pick count', () => {
    for (let k = KENO.MIN_PICKS; k <= KENO.MAX_PICKS; k += 1) {
      let sum = 0;
      for (let h = 0; h <= k; h += 1) sum += kenoHitProbability(k, h);
      expect(sum).toBeCloseTo(1, 12);
    }
  });

  it('every paytable returns at most — and within 0.5% of — the platform RTP', () => {
    for (const risk of KENO_RISKS) {
      for (let k = KENO.MIN_PICKS; k <= KENO.MAX_PICKS; k += 1) {
        const table = kenoPaytable(risk, k);
        const ev = table.reduce((e, m, h) => e + m * kenoHitProbability(k, h), 0);
        expect(ev, `${risk}/${k}`).toBeLessThanOrEqual(RTP + 1e-12);
        expect(ev, `${risk}/${k}`).toBeGreaterThan(RTP - 0.005);
        expect(table[k]).toBeGreaterThan(0); // hitting everything always pays
      }
    }
  });

  it('empirical draw distribution matches the hypergeometric model', () => {
    const picks = [1, 2, 3, 4, 5];
    const counts = new Array(6).fill(0);
    const N = 20_000;
    for (let i = 0; i < N; i += 1) counts[kenoHits(picks, kenoDraw('mc', 'c', i))] += 1;
    for (let h = 0; h <= 5; h += 1) {
      const p = kenoHitProbability(5, h);
      expect(Math.abs(counts[h] / N - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N) + 1e-4);
    }
  });
});
