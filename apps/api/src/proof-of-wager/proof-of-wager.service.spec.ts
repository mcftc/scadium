import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SCAD, WAGER, LAMPORTS_PER_SOL } from '@scadium/shared';
import { ProofOfWagerService, periodKeys } from './proof-of-wager.service';

/**
 * Locks the central accrual math the 6 game engines now delegate to:
 *   amount = stake × SCAD.WAGER_REWARD_PER_LAMPORT × tierMult × campaignMult
 * and that the daily + weekly leaderboard buckets are upserted in-tx.
 */
function makeTx(opts: { totalWagered: bigint; campaigns?: unknown[]; scadAfter?: bigint }) {
  const userUpdate = vi.fn().mockResolvedValue({});
  const upsert = vi.fn().mockResolvedValue({});
  return {
    tx: {
      user: {
        findUnique: vi.fn().mockResolvedValue({ totalWagered: opts.totalWagered }),
        update: userUpdate,
      },
      wagerCampaign: { findMany: vi.fn().mockResolvedValue(opts.campaigns ?? []) },
      wagerLeaderboard: { upsert },
    },
    userUpdate,
    upsert,
  };
}

describe('ProofOfWagerService.accrue (unit)', () => {
  let svc: ProofOfWagerService;
  beforeEach(() => {
    // PrismaService is only used by the read-only leaderboard() helper, not accrue.
    svc = new ProofOfWagerService({} as never);
  });

  it('base tier (no campaign): credits stake × 128 SCAD and upserts 2 leaderboard buckets', async () => {
    const { tx, userUpdate, upsert } = makeTx({ totalWagered: 0n });
    const stake = 1_000_000n; // 0.001 SOL
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'dice',
      stakeLamports: stake,
    });

    expect(amount).toBe(stake * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT));
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { scadiumBalance: { increment: amount } },
    });
    expect(upsert).toHaveBeenCalledTimes(2); // daily + weekly
  });

  it('applies the lifetime-wager tier multiplier', async () => {
    // totalWagered above the 100-SOL threshold → tier 2 (×1.25).
    const { tx } = makeTx({ totalWagered: BigInt(100 * LAMPORTS_PER_SOL) });
    const stake = 1_000_000n;
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'limbo',
      stakeLamports: stake,
    });
    const base = stake * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT);
    const expected = (base * BigInt(Math.round(1.25 * 1000))) / 1000n;
    expect(amount).toBe(expected);
  });

  it('caps the combined multiplier at WAGER.MAX_MULTIPLIER', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    const { tx } = makeTx({
      totalWagered: BigInt(1_000 * LAMPORTS_PER_SOL), // top tier ×1.5
      campaigns: [{ active: true, multiplier: 100, gameType: null, startsAt: past, endsAt: future }],
    });
    const stake = 1_000_000n;
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'wheel',
      stakeLamports: stake,
    });
    const base = stake * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT);
    const capped = (base * BigInt(Math.round(WAGER.MAX_MULTIPLIER * 1000))) / 1000n;
    expect(amount).toBe(capped);
  });

  it('zero/negative stake accrues nothing', async () => {
    const { tx, userUpdate } = makeTx({ totalWagered: 0n });
    expect(await svc.accrue(tx as never, { userId: 'u1', gameType: 'dice', stakeLamports: 0n })).toBe(
      0n,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe('periodKeys', () => {
  it('produces UTC daily + ISO-week weekly keys', () => {
    const { daily, weekly } = periodKeys(new Date('2026-06-18T12:00:00Z'));
    expect(daily).toBe('daily:20260618');
    expect(weekly).toMatch(/^weekly:2026\d{2}$/);
  });
});
