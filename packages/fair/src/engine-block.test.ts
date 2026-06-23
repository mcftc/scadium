import { describe, it, expect } from 'vitest';
import {
  SCAD,
  ENGINE,
  blockRewardFor,
  activePlayRate,
  stakePlayRate,
  blockShare,
} from '@scadium/shared';

const E9 = 1_000_000_000n;

describe('Engine v2 — block-reward schedule', () => {
  it('phase 1 pays the full hourly block reward', () => {
    expect(blockRewardFor(0n)).toBe(ENGINE.BLOCK_REWARD_PHASE1_BASE);
    expect(blockRewardFor(0n)).toBe(10_000n * E9);
  });

  it('halves the block reward each phase', () => {
    // At the phase-1 cap (75M emitted) the active phase is 2 → reward halves.
    const atPhase2 = 75_000_000n * E9;
    expect(blockRewardFor(atPhase2)).toBe(5_000n * E9);
    // Phase 3 (150M emitted) → quartered.
    expect(blockRewardFor(150_000_000n * E9)).toBe(2_500n * E9);
  });

  it('clamps to the remaining P2E pool and stops at exhaustion', () => {
    expect(blockRewardFor(SCAD.P2E_POOL_BASE - 100n)).toBe(100n);
    expect(blockRewardFor(SCAD.P2E_POOL_BASE)).toBe(0n);
  });
});

describe('Engine v2 — play-rate + share math', () => {
  it('active play-rate scales lamports by the tier multiplier (milli)', () => {
    expect(activePlayRate(1n * E9)).toBe(1n * E9); // default 1.0×
    expect(activePlayRate(1n * E9, 1500)).toBe((3n * E9) / 2n); // 1.5×
    expect(activePlayRate(0n, 1500)).toBe(0n);
  });

  it('staking contributes a passive play-rate (STAKE_PLAYRATE_BPS)', () => {
    // 1000 SCAD staked × 1% = 10 SOL-equiv lamports.
    expect(stakePlayRate(1000n * E9)).toBe((1000n * E9 * BigInt(ENGINE.STAKE_PLAYRATE_BPS)) / 10_000n);
    expect(stakePlayRate(0n)).toBe(0n);
  });

  it('block share is pro-rata and floored (dust stays in the pool)', () => {
    const reward = 100n * E9;
    // 30 / (30+70) → exact 30/70 split summing to the reward.
    expect(blockShare(30n, 100n, reward)).toBe(30n * E9);
    expect(blockShare(70n, 100n, reward)).toBe(70n * E9);
    // Non-divisible → floored.
    expect(blockShare(1n, 3n, 100n)).toBe(33n);
    expect(blockShare(0n, 100n, reward)).toBe(0n);
    expect(blockShare(10n, 0n, reward)).toBe(0n);
  });
});
