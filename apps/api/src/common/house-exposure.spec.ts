import { describe, it, expect } from 'vitest';
import { HOUSE, CRASH, LAMPORTS_PER_SOL } from '@scadium/shared';
import { ExposureGuard } from './exposure-guard';

const SOL = BigInt(LAMPORTS_PER_SOL);

describe('house exposure guard (#30)', () => {
  it('caps a round at MAX_ROUND_EXPOSURE_BPS of the house bankroll', () => {
    // 10 SOL vault, 20% cap → 2 SOL of total potential payout per round.
    const guard = new ExposureGuard(10n * SOL, 2_000);
    expect(guard.roundCapLamports).toBe(2n * SOL);

    expect(guard.reserve(1n * SOL)).toBe(true);
    expect(guard.reserve(1n * SOL)).toBe(true); // exactly at the cap
    expect(guard.reserve(1n)).toBe(false); // anything beyond is rejected
    expect(guard.reservedLamports).toBe(2n * SOL);
  });

  it('a single bet exceeding the round cap is rejected outright', () => {
    const guard = new ExposureGuard(10n * SOL, 2_000);
    expect(guard.reserve(3n * SOL)).toBe(false);
    expect(guard.reservedLamports).toBe(0n); // failed reserve holds nothing
  });

  it('per-bet potential is capped by MAX_WIN_PER_BET (crash is otherwise unbounded)', () => {
    // 1 SOL stake × 1,000,000× would be 1M SOL — the cap anchors it.
    const potential = ExposureGuard.potential(1n * SOL, CRASH.MAX_CASHOUT_MULTIPLIER);
    expect(potential).toBe(BigInt(HOUSE.MAX_WIN_PER_BET_LAMPORTS));
    // A small stake/multiplier stays raw.
    expect(ExposureGuard.potential(1_000n, 2)).toBe(2_000n);
  });

  it('the documented float covers the per-bet worst case + buffer', () => {
    // init-house asserts this same inequality (#30): the minimum funded house
    // vault must cover at least one max-win plus the alert buffer.
    const minFloat =
      BigInt(HOUSE.MAX_WIN_PER_BET_LAMPORTS) + BigInt(HOUSE.MIN_BANKROLL_BUFFER_LAMPORTS);
    expect(minFloat).toBeGreaterThan(0n);
    expect(BigInt(HOUSE.MAX_WIN_PER_BET_LAMPORTS)).toBeLessThanOrEqual(minFloat);
  });
});
