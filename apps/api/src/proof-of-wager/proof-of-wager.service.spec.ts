import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SCAD, WAGER, LAMPORTS_PER_SOL, emissionPhaseFor } from '@scadium/shared';
import { ProofOfWagerService, periodKeys } from './proof-of-wager.service';

/**
 * Locks the central accrual math the 6 game engines now delegate to:
 *   amount = stake × SCAD.WAGER_REWARD_PER_LAMPORT × tierMult × campaignMult
 * and that the daily + weekly leaderboard buckets are upserted in-tx.
 *
 * Emission is NOT touched per bet (that exhausted the connection pool under load
 * — chaos/balance-race). accrue() reads the halving phase from a CACHE on
 * `this.prisma` (refreshed at most once per TTL) and BUFFERS the mint in memory;
 * the buffer is flushed on the next cache refresh. So the tx mock has NO
 * emissionState ops; the seeded cumulative total lives behind `this.prisma`.
 */
function makeTx(opts: { totalWagered: bigint; campaigns?: unknown[]; scadAfter?: bigint }) {
  const userUpdate = vi.fn().mockResolvedValue({});
  const upsert = vi.fn().mockResolvedValue({});
  const ledgerCreate = vi.fn().mockResolvedValue({});
  // `applyBalanceDelta` (the $SCAD credit path, #229) reads the post-credit
  // balance to stamp `balanceAfter` and writes a BalanceLedger row in-tx.
  const scadAfter = opts.scadAfter ?? 0n;
  return {
    tx: {
      user: {
        // `accrue` reads totalWagered; `applyBalanceDelta` reads scadiumBalance.
        findUnique: vi.fn().mockResolvedValue({ totalWagered: opts.totalWagered }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ scadiumBalance: scadAfter }),
        update: userUpdate,
      },
      wagerCampaign: { findMany: vi.fn().mockResolvedValue(opts.campaigns ?? []) },
      wagerLeaderboard: { upsert },
      balanceLedger: { create: ledgerCreate },
    },
    userUpdate,
    upsert,
    ledgerCreate,
  };
}

/**
 * Fake PrismaService exposing only `emissionState.findUnique`/`upsert` — the off-
 * tx connection accrue()'s emission cache uses. `findUnique` returns the seeded
 * cumulative total; `upsert` records the flushed buffer. The returned `svc` has
 * its emission cache reset so the seeded value is read on the next accrue.
 */
function makeSvc(totalEmitted = 0n) {
  const upsert = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn().mockResolvedValue({
    id: 'singleton',
    totalEmittedScad: totalEmitted,
  });
  const prisma = { emissionState: { findUnique, upsert } };
  const svc = new ProofOfWagerService(prisma as never);
  svc.__resetEmissionCacheForTest();
  return { svc, emissionFindUnique: findUnique, emissionUpsert: upsert };
}

describe('ProofOfWagerService.accrue (unit)', () => {
  let svc: ProofOfWagerService;
  beforeEach(() => {
    // Emission cache reads off `this.prisma` (seeded at 0 here); the tx mock has
    // no emissionState ops — accrue buffers the mint in memory, no per-bet DB op.
    ({ svc } = makeSvc(0n));
  });

  it('base tier (no campaign): credits stake × 128 SCAD and upserts 2 leaderboard buckets', async () => {
    const { tx, userUpdate, upsert, ledgerCreate } = makeTx({ totalWagered: 0n });
    const stake = 1_000_000n; // 0.001 SOL
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'dice',
      stakeLamports: stake,
      betId: 'bet-1',
    });

    // Phase 1 rate is the legacy 128/lamport → amounts unchanged at emission start.
    expect(amount).toBe(stake * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT));
    // The buffered emission counter advances in memory (no per-bet DB write).
    expect(await svc.totalEmitted()).toBe(amount);
    // The $SCAD credit now flows through applyBalanceDelta (#229): a guarded
    // increment of scadiumBalance + a `scad` BalanceLedger row in the same tx.
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { scadiumBalance: { increment: amount } },
    });
    expect(ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          currency: 'scad',
          delta: amount,
          reason: 'wager_reward',
          refType: 'Bet',
          refId: 'bet-1',
        }),
      }),
    );
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
      campaigns: [
        { active: true, multiplier: 100, gameType: null, startsAt: past, endsAt: future },
      ],
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
    expect(
      await svc.accrue(tx as never, { userId: 'u1', gameType: 'dice', stakeLamports: 0n }),
    ).toBe(0n);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe('ProofOfWagerService.accrue — emission halving + cap (unit)', () => {
  const oneSol = BigInt(LAMPORTS_PER_SOL);

  it('uses the phase rate at the START of accrue (crossing a cap halves the rate)', async () => {
    // Seed cumulative emission to exactly phase-1's cap (75M × 1e9): the active
    // phase is now phase 2 → rate 64/lamport (halved from 128).
    const atCap1 = SCAD.EMISSION_PHASES[0]!.cumulativeCapBase;
    expect(emissionPhaseFor(atCap1).ratePerLamport).toBe(64);

    const { svc } = makeSvc(atCap1);
    const { tx } = makeTx({ totalWagered: 0n });
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'dice',
      stakeLamports: oneSol,
    });
    // 1 SOL × 64/lamport = 64e9 base units (NOT 128e9).
    expect(amount).toBe(oneSol * 64n);
    // Buffer reflects the seeded total + this mint (no per-bet DB write).
    expect(await svc.totalEmitted()).toBe(atCap1 + amount);
  });

  it('halves again at the phase-3 boundary (32/lamport)', async () => {
    const atCap2 = SCAD.EMISSION_PHASES[1]!.cumulativeCapBase; // 150M × 1e9
    const { svc } = makeSvc(atCap2);
    const { tx } = makeTx({ totalWagered: 0n });
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'dice',
      stakeLamports: oneSol,
    });
    expect(amount).toBe(oneSol * 32n);
  });

  it('CAP: clamps an accrual that would overshoot the 500M pool', async () => {
    // 100 base units below the pool ceiling; a 1-SOL wager at phase-7 rate (2)
    // would mint 2e9 but only 100 remain → clamp to 100.
    const nearCap = SCAD.P2E_POOL_BASE - 100n;
    const { svc } = makeSvc(nearCap);
    const { tx } = makeTx({ totalWagered: 0n });
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'dice',
      stakeLamports: oneSol,
    });
    expect(amount).toBe(100n);
    // Buffered counter never lets effective emission exceed the pool.
    expect(await svc.totalEmitted()).toBe(SCAD.P2E_POOL_BASE);
    expect(nearCap + amount).toBe(SCAD.P2E_POOL_BASE);
  });

  it('returns 0n once the pool is exhausted (emission ended)', async () => {
    const { svc } = makeSvc(SCAD.P2E_POOL_BASE);
    const { tx, userUpdate } = makeTx({ totalWagered: 0n });
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'dice',
      stakeLamports: oneSol,
    });
    expect(amount).toBe(0n);
    expect(userUpdate).not.toHaveBeenCalled(); // no credit
    expect(await svc.totalEmitted()).toBe(SCAD.P2E_POOL_BASE); // counter unchanged
  });

  it('effectiveMultiplier still composes on top of the phase rate', async () => {
    // Phase 2 (rate 64) + tier-2 lifetime wager (×1.25), no campaign.
    const atCap1 = SCAD.EMISSION_PHASES[0]!.cumulativeCapBase;
    const { svc } = makeSvc(atCap1);
    const { tx } = makeTx({ totalWagered: BigInt(100 * LAMPORTS_PER_SOL) });
    const amount = await svc.accrue(tx as never, {
      userId: 'u1',
      gameType: 'dice',
      stakeLamports: oneSol,
    });
    const base = oneSol * 64n;
    const expected = (base * BigInt(Math.round(1.25 * 1000))) / 1000n;
    expect(amount).toBe(expected);
  });
});

describe('ProofOfWagerService.effectiveMultiplier (unit, #205)', () => {
  const svc = new ProofOfWagerService({} as never);

  // The same float multiplier accrue() applies (min(tier × campaign, MAX)); the
  // readout must NOT duplicate the math — it calls this exact method.
  function appliedByAccrue(totalWagered: bigint, campaignMult = 1.0): number {
    const thresholds = WAGER.TIER_THRESHOLDS_LAMPORTS;
    let tier: number = WAGER.TIER_MULTIPLIER[0];
    for (let i = 0; i < thresholds.length; i += 1) {
      if (totalWagered >= BigInt(thresholds[i]!)) tier = WAGER.TIER_MULTIPLIER[i] ?? tier;
    }
    return Math.min(tier * campaignMult, WAGER.MAX_MULTIPLIER);
  }

  it('matches accrue() across every tier boundary', () => {
    const cases = [
      0n, // tier 0 ×1.0
      BigInt(10 * LAMPORTS_PER_SOL - 1), // just below tier 1
      BigInt(10 * LAMPORTS_PER_SOL), // tier 1 ×1.1
      BigInt(100 * LAMPORTS_PER_SOL), // tier 2 ×1.25
      BigInt(1_000 * LAMPORTS_PER_SOL), // tier 3 ×1.5
      BigInt(10_000 * LAMPORTS_PER_SOL), // still top tier
    ];
    for (const w of cases) {
      expect(svc.effectiveMultiplier(w)).toBeCloseTo(appliedByAccrue(w), 10);
    }
  });

  it('folds in an active campaign multiplier', () => {
    const w = BigInt(100 * LAMPORTS_PER_SOL); // tier 2 ×1.25
    expect(svc.effectiveMultiplier(w, 2.0)).toBeCloseTo(appliedByAccrue(w, 2.0), 10);
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
