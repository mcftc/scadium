import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CrashEngine } from '../src/games/crash/crash.engine';
import { CrashService } from '../src/games/crash/crash.service';

/**
 * #72 — crash scheduled-bet durability (integration, real Postgres). A
 * next-round bet debits the balance and persists a `ScheduledCrashBet` row in
 * the same tx; the in-memory queue is lost on restart, so on boot every such
 * row is an orphan that must be refunded (with a ledger row) exactly once.
 * Proves: recovery refunds the orphan, is idempotent, and never touches a
 * drained bet (which holds a CrashBet, not a ScheduledCrashBet).
 */
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

async function makeUser(balance: bigint) {
  const id = randomUUID();
  return prisma.user.create({
    data: { walletAddress: `sched-${id}`, refCode: `sched-ref-${id}`, playBalanceLamports: balance },
  });
}
async function makeSeed() {
  const id = randomUUID();
  return prisma.seed.create({
    data: { serverSeed: `srv-${id}`, serverSeedHash: `hash-${id}`, clientSeed: `cli-${id}`, nonce: 0 },
  });
}
function makeCrashEngine() {
  const gateway = new Proxy({}, { get: () => () => undefined }) as never;
  const chain = { enabled: false } as never;
  return new CrashEngine(prisma as never, gateway, chain);
}
const recoverScheduled = (engine: unknown) =>
  (engine as { recoverScheduledBets: () => Promise<void> }).recoverScheduledBets();
// cancelScheduled is DB-authoritative; the engine call is best-effort, so a stub suffices.
function makeCrashService() {
  const engineStub = { cancelScheduled: () => ({ amountLamports: 0n }) } as never;
  const rg = { assertCanWager: async () => undefined } as never;
  const affiliates = { creditReferral: async () => undefined } as never;
  return new CrashService(prisma as never, engineStub, rg, affiliates);
}

describe('crash scheduled-bet durability (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refunds an orphaned scheduled bet exactly once (with a ledger row) and deletes it', async () => {
    const u = await makeUser(0n); // already debited at schedule time
    const sched = await prisma.scheduledCrashBet.create({
      data: { userId: u.id, amountLamports: 1_000n, autoCashoutMultiplier: null },
    });

    await recoverScheduled(makeCrashEngine());

    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(1_000n);
    expect(
      await prisma.balanceLedger.count({ where: { userId: u.id, reason: 'crash_scheduled_refund' } }),
    ).toBe(1);
    expect(await prisma.scheduledCrashBet.findUnique({ where: { id: sched.id } })).toBeNull();

    // Idempotent: a second boot must not credit again (the row is gone).
    await recoverScheduled(makeCrashEngine());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(1_000n);
    expect(
      await prisma.balanceLedger.count({ where: { userId: u.id, reason: 'crash_scheduled_refund' } }),
    ).toBe(1);
  });

  it('does NOT refund a drained bet (CrashBet, no ScheduledCrashBet) — no double credit', async () => {
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });
    const u = await makeUser(0n);
    // A drained scheduled bet: it became a CrashBet and its ScheduledCrashBet was
    // deleted in the same tx — round recovery (not this path) handles it.
    await prisma.crashBet.create({
      data: { roundId: round.id, userId: u.id, amountLamports: 1_000n, remainingLamports: 1_000n, payoutLamports: 0n, won: false },
    });

    await recoverScheduled(makeCrashEngine());

    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(0n);
    expect(
      await prisma.balanceLedger.count({ where: { userId: u.id, reason: 'crash_scheduled_refund' } }),
    ).toBe(0);
  });

  it('cancelScheduled refunds the durable stake exactly once and rejects a double cancel', async () => {
    const u = await makeUser(0n);
    await prisma.scheduledCrashBet.create({
      data: { userId: u.id, amountLamports: 2_000n, autoCashoutMultiplier: null },
    });
    const svc = makeCrashService();

    const res = await svc.cancelScheduled(u.id);
    expect(res.refundedLamports).toBe('2000');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(2_000n);
    expect(await prisma.scheduledCrashBet.findUnique({ where: { userId: u.id } })).toBeNull();
    expect(await prisma.balanceLedger.count({ where: { userId: u.id, reason: 'refund' } })).toBe(1);

    // Second cancel: the row is gone (DB-authoritative) → rejected, no double refund.
    await expect(svc.cancelScheduled(u.id)).rejects.toThrow(/No scheduled bet/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(2_000n);
  });
});
