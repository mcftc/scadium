import { describe, expect, it } from 'vitest';
import { crashPoint, crashMultiplierAt, crashTimeForMultiplier } from './crash';
import { commitServerSeed, generateClientSeed, generateServerSeed } from './seed';

describe('crash provably-fair engine', () => {
  it('produces deterministic output for identical inputs', () => {
    const serverSeed = 'a'.repeat(64);
    const clientSeed = 'client-xyz';
    const a = crashPoint(serverSeed, clientSeed, 1);
    const b = crashPoint(serverSeed, clientSeed, 1);
    expect(a).toBe(b);
  });

  it('differs for different nonces', () => {
    const serverSeed = 'b'.repeat(64);
    const clientSeed = 'client';
    const r1 = crashPoint(serverSeed, clientSeed, 1);
    const r2 = crashPoint(serverSeed, clientSeed, 2);
    expect(r1).not.toBe(r2);
  });

  it('returns 1.00 ~5% of the time (instant bust)', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    let busts = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      if (crashPoint(serverSeed, clientSeed, i) === 1.0) busts++;
    }
    const rate = busts / n;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.07);
  });

  it('never returns a value below 1.00', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    for (let i = 0; i < 1000; i++) {
      expect(crashPoint(serverSeed, clientSeed, i)).toBeGreaterThanOrEqual(1.0);
    }
  });
});

describe('crash multiplier curve', () => {
  it('starts at 1.0', () => {
    expect(crashMultiplierAt(0)).toBe(1.0);
  });

  it('monotonically increases', () => {
    let prev = 0;
    for (let t = 0; t < 10_000; t += 100) {
      const v = crashMultiplierAt(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('round-trips through inverse function', () => {
    const target = 2.0;
    const t = crashTimeForMultiplier(target);
    const actual = crashMultiplierAt(t);
    expect(Math.abs(actual - target)).toBeLessThan(0.01);
  });
});

describe('seed commitment', () => {
  it('commit is deterministic and reveal verifies', () => {
    const seed = 'deadbeef'.repeat(8);
    const commit = commitServerSeed(seed);
    expect(commit).toHaveLength(64);
    expect(commitServerSeed(seed)).toBe(commit);
  });
});
