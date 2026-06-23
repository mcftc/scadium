import { describe, it, expect, vi } from 'vitest';
import { WAGER, LAMPORTS_PER_SOL } from '@scadium/shared';
import { ProofOfWagerService, periodKeys } from './proof-of-wager.service';

/**
 * Engine v2 (E3): accrue() no longer MINTS $SCAD per bet — the hourly block
 * worker (BlockMiningService) is the single emission authority, minting each
 * hour's halving-phase block reward split by play-rate. accrue() now ONLY
 * records wager VOLUME into the daily + weekly leaderboard buckets (which also
 * feed the play-rate the block split reads). These lock that contract: it
 * upserts 2 buckets, credits NOTHING, and no-ops on a zero stake.
 */
function makeTx() {
  const upsert = vi.fn().mockResolvedValue({});
  const userUpdate = vi.fn().mockResolvedValue({});
  const ledgerCreate = vi.fn().mockResolvedValue({});
  return {
    tx: {
      user: { update: userUpdate, findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
      wagerLeaderboard: { upsert },
      balanceLedger: { create: ledgerCreate },
    },
    upsert,
    userUpdate,
    ledgerCreate,
  };
}

describe('ProofOfWagerService.accrue (unit) — records volume, mints nothing', () => {
  const svc = new ProofOfWagerService({} as never);

  it('a positive wager upserts the daily + weekly leaderboard buckets and credits nothing', async () => {
    const { tx, upsert, userUpdate, ledgerCreate } = makeTx();
    const stake = 1_000_000n; // 0.001 SOL
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'dice',
      stakeLamports: stake,
      betId: 'bet-1',
    });

    expect(amount).toBe(0n); // no per-bet mint — the block worker mints now
    expect(upsert).toHaveBeenCalledTimes(2); // daily + weekly
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'u1', wageredLamports: stake }),
        update: expect.objectContaining({ wageredLamports: { increment: stake } }),
      }),
    );
    // No $SCAD credit: no balance increment, no `scad` ledger row.
    expect(userUpdate).not.toHaveBeenCalled();
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('zero/negative stake records nothing', async () => {
    const { tx, upsert } = makeTx();
    expect(
      await svc.accrue(tx as never, { userId: 'u1', gameType: 'dice', stakeLamports: 0n }),
    ).toBe(0n);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('ProofOfWagerService.effectiveMultiplier (unit, #205 — earn-rate readout)', () => {
  const svc = new ProofOfWagerService({} as never);

  // The display multiplier (min(tier × campaign, MAX)) used by the earn-rate
  // readout. (accrue() no longer mints, but the readout still surfaces the
  // tier/campaign boost a future play-rate weighting can apply.)
  function expectedMult(totalWagered: bigint, campaignMult = 1.0): number {
    const thresholds = WAGER.TIER_THRESHOLDS_LAMPORTS;
    let tier: number = WAGER.TIER_MULTIPLIER[0];
    for (let i = 0; i < thresholds.length; i += 1) {
      if (totalWagered >= BigInt(thresholds[i]!)) tier = WAGER.TIER_MULTIPLIER[i] ?? tier;
    }
    return Math.min(tier * campaignMult, WAGER.MAX_MULTIPLIER);
  }

  it('resolves the right multiplier across every tier boundary', () => {
    const cases = [
      0n,
      BigInt(10 * LAMPORTS_PER_SOL - 1),
      BigInt(10 * LAMPORTS_PER_SOL),
      BigInt(100 * LAMPORTS_PER_SOL),
      BigInt(1_000 * LAMPORTS_PER_SOL),
      BigInt(10_000 * LAMPORTS_PER_SOL),
    ];
    for (const w of cases) {
      expect(svc.effectiveMultiplier(w)).toBeCloseTo(expectedMult(w), 10);
    }
  });

  it('folds in an active campaign multiplier', () => {
    const w = BigInt(100 * LAMPORTS_PER_SOL); // tier 2 ×1.25
    expect(svc.effectiveMultiplier(w, 2.0)).toBeCloseTo(expectedMult(w, 2.0), 10);
    expect(svc.effectiveMultiplier(w, 2.0)).toBeCloseTo(2.5, 10); // 1.25 × 2.0
  });

  it('caps at WAGER.MAX_MULTIPLIER', () => {
    const w = BigInt(1_000 * LAMPORTS_PER_SOL); // top tier ×1.5
    expect(svc.effectiveMultiplier(w, 100)).toBe(WAGER.MAX_MULTIPLIER);
  });
});

describe('periodKeys', () => {
  it('produces UTC daily + ISO-week weekly keys', () => {
    const { daily, weekly } = periodKeys(new Date('2026-06-18T12:00:00Z'));
    expect(daily).toBe('daily:20260618');
    expect(weekly).toMatch(/^weekly:2026\d{2}$/);
  });
});
