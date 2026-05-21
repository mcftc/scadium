import { describe, expect, it } from 'vitest';
import { coinflipResult } from './coinflip';
import { generateServerSeed, generateClientSeed } from './seed';

describe('coinflip provably-fair engine', () => {
  it('is deterministic', () => {
    const s = 'c'.repeat(64);
    expect(coinflipResult(s, 'x', 0)).toBe(coinflipResult(s, 'x', 0));
  });

  it('produces ~50/50 distribution over many trials', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    let heads = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      if (coinflipResult(serverSeed, clientSeed, i) === 'heads') heads++;
    }
    const rate = heads / n;
    expect(rate).toBeGreaterThan(0.47);
    expect(rate).toBeLessThan(0.53);
  });
});
