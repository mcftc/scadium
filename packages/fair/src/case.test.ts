import { describe, expect, it } from 'vitest';
import { dailyCaseRoll, pickCaseTier } from './case';
import { generateClientSeed, generateServerSeed } from './seed';

// Mirror of SCAD.CASE_TIERS (packages/shared) — duplicated here so the fair
// package stays dependency-free; the semantics test below locks the mapping.
const TIERS = [
  { tier: 'legendary', chance: 0.001, scadBase: 100_000_000_000_000 },
  { tier: 'epic', chance: 0.01, scadBase: 10_000_000_000_000 },
  { tier: 'rare', chance: 0.1, scadBase: 1_000_000_000_000 },
  { tier: 'common', chance: 1, scadBase: 100_000_000_000 },
] as const;

describe('daily case provably-fair roll', () => {
  it('is deterministic: identical (serverSeed, clientSeed, nonce) → identical tier', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    for (let nonce = 1; nonce <= 100; nonce++) {
      const a = dailyCaseRoll(serverSeed, clientSeed, nonce);
      const b = dailyCaseRoll(serverSeed, clientSeed, nonce);
      expect(a).toBe(b);
      expect(pickCaseTier(a, TIERS)).toBe(pickCaseTier(b, TIERS));
    }
  });

  it('rolls land in [0, 1)', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    for (let nonce = 0; nonce < 1000; nonce++) {
      const r = dailyCaseRoll(serverSeed, clientSeed, nonce);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it('different nonces produce different rolls (no stuck output)', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const rolls = new Set<number>();
    for (let nonce = 0; nonce < 100; nonce++) {
      rolls.add(dailyCaseRoll(serverSeed, clientSeed, nonce));
    }
    expect(rolls.size).toBeGreaterThan(95);
  });

  it('pickCaseTier keeps the legacy cumulative-threshold semantics', () => {
    expect(pickCaseTier(0, TIERS).tier).toBe('legendary');
    expect(pickCaseTier(0.0009, TIERS).tier).toBe('legendary');
    expect(pickCaseTier(0.001, TIERS).tier).toBe('epic');
    expect(pickCaseTier(0.0099, TIERS).tier).toBe('epic');
    expect(pickCaseTier(0.01, TIERS).tier).toBe('rare');
    expect(pickCaseTier(0.099, TIERS).tier).toBe('rare');
    expect(pickCaseTier(0.1, TIERS).tier).toBe('common');
    expect(pickCaseTier(0.9999, TIERS).tier).toBe('common');
  });

  it('throws on an empty tier table', () => {
    expect(() => pickCaseTier(0.5, [])).toThrow('empty tier table');
  });

  it('empirical tier distribution over 100k rolls matches configured chances', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const N = 100_000;
    const counts: Record<string, number> = { legendary: 0, epic: 0, rare: 0, common: 0 };
    for (let nonce = 0; nonce < N; nonce++) {
      const tier = pickCaseTier(dailyCaseRoll(serverSeed, clientSeed, nonce), TIERS).tier;
      counts[tier] = (counts[tier] ?? 0) + 1;
    }
    // Cumulative thresholds → marginal probabilities: 0.1%, 0.9%, 9%, 90%.
    // Tolerances ≈ ±5σ of a binomial at N=100k so the test is deterministic in
    // spirit but never flaky in practice.
    expect(counts.legendary! / N).toBeGreaterThanOrEqual(0.0005);
    expect(counts.legendary! / N).toBeLessThanOrEqual(0.002);
    expect(counts.epic! / N).toBeGreaterThanOrEqual(0.007);
    expect(counts.epic! / N).toBeLessThanOrEqual(0.011);
    expect(counts.rare! / N).toBeGreaterThanOrEqual(0.08);
    expect(counts.rare! / N).toBeLessThanOrEqual(0.1);
    expect(counts.common! / N).toBeGreaterThanOrEqual(0.88);
    expect(counts.common! / N).toBeLessThanOrEqual(0.92);
  });
});
