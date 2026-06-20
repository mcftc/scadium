import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SCAD, LAMPORTS_PER_SOL, emissionPhaseFor } from '@scadium/shared';
import { prisma, makeUser, realPow } from './engine-harness';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * Emission halving (Part A) integration against real Postgres. Proves the money
 * path: accrue() reads the cumulative emission (a CACHE off `this.prisma`,
 * refreshed at most once per TTL), mints at the active phase rate, clamps to the
 * 500M P2E pool, BUFFERS the mint in memory, and FLUSHES the buffer to the
 * EmissionState singleton on the next cache refresh. The $SCAD credit stays the
 * in-tx applyBalanceDelta('scad'), so scadLedgerDrift stays ZERO. Emission is
 * NEVER touched per bet (that exhausted the Prisma pool — chaos/balance-race).
 *
 * Because the cache is warmed once per TTL, tests that seed EmissionState then
 * assert the next accrue's phase MUST `__resetEmissionCacheForTest()` after
 * seeding (so the seeded value is read immediately) and again before reading the
 * persisted total back (so the in-memory buffer is flushed to the row).
 *
 * The EmissionState singleton is GLOBAL (one row, shared across the test DB), so
 * each test snapshots + restores `totalEmittedScad` to avoid contaminating the
 * other suites that accrue (they all assume phase 1 / 128).
 */
const pow = realPow();

/** Seed the persistent total AND force the service to re-read it next accrue. */
async function seedEmitted(total: bigint) {
  await setEmitted(total);
  pow.__resetEmissionCacheForTest();
}

/** Flush the in-memory emission buffer to the row, then read the persisted total. */
async function flushedEmitted(): Promise<bigint> {
  await pow.__flushEmissionForTest(); // expire cache + flush pendingEmitted → row
  return getEmitted();
}
const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);

const SINGLETON = 'singleton';

/** Set the cumulative emitted total directly (test seam only). */
async function setEmitted(total: bigint) {
  await prisma.emissionState.upsert({
    where: { id: SINGLETON },
    update: { totalEmittedScad: total },
    create: { id: SINGLETON, totalEmittedScad: total },
  });
}
async function getEmitted(): Promise<bigint> {
  const row = await prisma.emissionState.findUnique({ where: { id: SINGLETON } });
  return row?.totalEmittedScad ?? 0n;
}

describe('Emission halving — accrue() phase rate + cap (integration)', () => {
  let savedEmitted = 0n;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    savedEmitted = await getEmitted();
  });
  afterAll(async () => {
    // Restore the global singleton so other suites see what they expect.
    await setEmitted(savedEmitted);
    await prisma.reconciliationDrift.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.balanceLedger.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wagerLeaderboard.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newUser(): Promise<string> {
    const u = await makeUser(0n);
    userIds.push(u.id);
    return u.id;
  }

  it('phase 1 mints at 128/lamport and increments EmissionState', async () => {
    await seedEmitted(0n);
    const userId = await newUser();
    const stake = BigInt(LAMPORTS_PER_SOL); // 1 SOL

    const amount = await prisma.$transaction((tx) =>
      pow.accrue(tx, { userId, gameType: 'crash', stakeLamports: stake }),
    );
    expect(amount).toBe(stake * 128n); // phase 1, tier 0
    // The buffered counter, flushed, advanced by exactly the mint.
    expect(await flushedEmitted()).toBe(amount);
  });

  it('crossing a phase cap halves the rate (phase 2 → 64/lamport)', async () => {
    const atCap1 = SCAD.EMISSION_PHASES[0]!.cumulativeCapBase; // 75M × 1e9
    await seedEmitted(atCap1);
    expect(emissionPhaseFor(atCap1).phase).toBe(2);

    const userId = await newUser();
    const stake = BigInt(LAMPORTS_PER_SOL);
    const amount = await prisma.$transaction((tx) =>
      pow.accrue(tx, { userId, gameType: 'dice', stakeLamports: stake }),
    );
    expect(amount).toBe(stake * 64n); // halved
    expect(await flushedEmitted()).toBe(atCap1 + amount);
  });

  it('clamps at the 500M pool and never exceeds P2E_POOL_BASE', async () => {
    const nearCap = SCAD.P2E_POOL_BASE - 100n;
    await seedEmitted(nearCap);
    const userId = await newUser();
    const stake = BigInt(LAMPORTS_PER_SOL); // would mint 2e9 at phase-7 rate

    const amount = await prisma.$transaction((tx) =>
      pow.accrue(tx, { userId, gameType: 'dice', stakeLamports: stake }),
    );
    expect(amount).toBe(100n); // clamped to remaining
    const after = await flushedEmitted();
    expect(after).toBe(SCAD.P2E_POOL_BASE);
    expect(after).toBeLessThanOrEqual(SCAD.P2E_POOL_BASE);
  });

  it('returns 0n once the pool is exhausted (emission ended)', async () => {
    await seedEmitted(SCAD.P2E_POOL_BASE);
    const userId = await newUser();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const amount = await prisma.$transaction((tx) =>
      pow.accrue(tx, { userId, gameType: 'dice', stakeLamports: BigInt(LAMPORTS_PER_SOL) }),
    );
    expect(amount).toBe(0n);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.scadiumBalance).toBe(before.scadiumBalance); // no credit
    expect(await flushedEmitted()).toBe(SCAD.P2E_POOL_BASE); // counter unchanged
  });

  it('atomicity: counter increment + $SCAD credit are one tx; scadLedgerDrift == ZERO', async () => {
    await seedEmitted(0n);
    const batch: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const userId = await newUser();
      batch.push(userId);
      await prisma.$transaction((tx) =>
        pow.accrue(tx, { userId, gameType: 'crash', stakeLamports: BigInt(LAMPORTS_PER_SOL) }),
      );
    }

    // Each user's live scadiumBalance equals their latest scad ledger balanceAfter.
    await reconciliation.scadLedgerDrift();
    const flagged = await prisma.reconciliationDrift.count({
      where: { userId: { in: batch }, field: 'scadiumBalance' },
    });
    expect(flagged).toBe(0);

    // The buffered counter, flushed, equals the sum of every $SCAD credit.
    const credited = batch.length * LAMPORTS_PER_SOL * 128;
    expect(await flushedEmitted()).toBe(BigInt(credited));
  });

  it('effectiveMultiplier composes on top of the phase rate (tier × phase)', async () => {
    const atCap1 = SCAD.EMISSION_PHASES[0]!.cumulativeCapBase; // phase 2 (rate 64)
    await seedEmitted(atCap1);
    // Fresh user with a tier-2 lifetime wager (≥100 SOL → ×1.25).
    const u = await prisma.user.create({
      data: {
        walletAddress: `emit-${randomUUID()}`,
        refCode: `emit-ref-${randomUUID()}`,
        totalWagered: BigInt(100 * LAMPORTS_PER_SOL),
      },
    });
    userIds.push(u.id);

    const stake = BigInt(LAMPORTS_PER_SOL);
    const amount = await prisma.$transaction((tx) =>
      pow.accrue(tx, { userId: u.id, gameType: 'dice', stakeLamports: stake }),
    );
    const base = stake * 64n;
    const expected = (base * BigInt(Math.round(1.25 * 1000))) / 1000n;
    expect(amount).toBe(expected);
  });

  afterEach(async () => {
    // Keep per-test isolation cheap: drift rows are recomputed each run.
    await prisma.reconciliationDrift.deleteMany({ where: { userId: { in: userIds } } });
  });
});
