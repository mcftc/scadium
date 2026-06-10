import { describe, expect, it } from 'vitest';
import { jackpotRoll, jackpotWinningTicket } from './jackpot';
import { generateClientSeed, generateServerSeed } from './seed';

const TWO_256 = 1n << 256n;

describe('jackpot provably-fair roll', () => {
  it('is deterministic for identical inputs', () => {
    const a = jackpotRoll('s'.repeat(64), 'client', 3);
    const b = jackpotRoll('s'.repeat(64), 'client', 3);
    expect(a).toBe(b);
  });

  it('returns the full 256-bit digest as a non-negative BigInt', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    for (let i = 0; i < 1000; i++) {
      const r = jackpotRoll(serverSeed, clientSeed, i);
      expect(typeof r).toBe('bigint');
      expect(r).toBeGreaterThanOrEqual(0n);
      expect(r).toBeLessThan(TWO_256);
    }
  });

  it('winning ticket lands within the pot', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const total = 5_000_000_000n; // 5 SOL pot
    for (let i = 0; i < 1000; i++) {
      const t = jackpotWinningTicket(serverSeed, clientSeed, i, total);
      expect(t).toBeGreaterThanOrEqual(0n);
      expect(t).toBeLessThan(total);
    }
  });

  it('returns 0 for an empty pot', () => {
    expect(jackpotWinningTicket('s'.repeat(64), 'c', 0, 0n)).toBe(0n);
  });

  // Regression guard for the legacy 52-bit / Number(total) defect: a pot just
  // above 2^53 lamports used to lose precision and bias the winner toward low
  // tickets. With a 256-bit roll reduced in BigInt, every ticket must stay in
  // range AND the distribution must be uniform across the pot.
  it('is precise and unbiased for a pot above 2^53 lamports', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const pot = (1n << 53n) + 1n; // 9_007_199_254_740_993 — not representable as an exact JS number
    const BUCKETS = 16;
    const bucketSize = pot / BigInt(BUCKETS);
    const counts = new Array<number>(BUCKETS).fill(0);
    const samples = 20_000;

    for (let i = 0; i < samples; i++) {
      const t = jackpotWinningTicket(serverSeed, clientSeed, i, pot);
      expect(t).toBeGreaterThanOrEqual(0n);
      expect(t).toBeLessThan(pot);
      const bucket = Math.min(BUCKETS - 1, Number(t / bucketSize));
      counts[bucket]!++;
    }

    // Chi-square goodness-of-fit against a uniform expectation. df = 15,
    // critical value ≈ 30.58 at p=0.01 — a biased (e.g. low-ticket-skewed)
    // distribution blows well past this.
    const expected = samples / BUCKETS;
    const chiSquare = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(chiSquare).toBeLessThan(30.58);
  });
});
