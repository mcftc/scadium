import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { withSerializable } from '../src/prisma/with-serializable';
import { CrashEngine } from '../src/games/crash/crash.engine';

// TODO(harness #9): fold this bootstrap into the shared concurrency harness.
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

const RUN = `${Date.now().toString(36)}`;
let seq = 0;
async function makeUser(balance: bigint) {
  seq += 1;
  return prisma.user.create({
    data: {
      walletAddress: `settle-${RUN}-${seq}`,
      refCode: `settle-ref-${RUN}-${seq}`,
      playBalanceLamports: balance,
    },
  });
}

async function makeSeed() {
  const s = `${RUN}-${seq++}`;
  return prisma.seed.create({
    data: { serverSeed: `srv-${s}`, serverSeedHash: `hash-${s}`, clientSeed: `cli-${s}`, nonce: 0 },
  });
}

describe('settlement atomicity (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ---- The core guarantee every engine now relies on ----

  it('withSerializable rolls back ALL writes when the closure throws (no partial ledger)', async () => {
    const user = await makeUser(1_000n);

    await expect(
      withSerializable(prisma, async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { playBalanceLamports: { increment: 5_000n } },
        });
        await tx.bet.create({
          data: { userId: user.id, gameType: 'crash', amountLamports: 0n, payoutLamports: 0n },
        });
        throw new Error('induced mid-settle failure');
      }),
    ).rejects.toThrow('induced mid-settle failure');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(1_000n); // credit rolled back
    const bets = await prisma.bet.count({ where: { userId: user.id } });
    expect(bets).toBe(0); // bet row rolled back
  });

  it('contrast: the OLD non-transactional pattern leaves partial state (why this fix matters)', async () => {
    const user = await makeUser(1_000n);
    // Emulate the pre-fix `Promise.all(ops)` with a log-only catch: the first
    // write commits on its own connection, then a later op fails — nothing
    // rolls it back.
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { playBalanceLamports: { increment: 5_000n } },
      });
      throw new Error('later op failed');
    } catch {
      /* swallowed, like the old log-only catch */
    }
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(6_000n); // partial credit SURVIVED — the bug
  });

  it('withSerializable commits all writes on success (happy path)', async () => {
    const user = await makeUser(1_000n);
    await withSerializable(prisma, async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { playBalanceLamports: { increment: 5_000n } },
      });
      await tx.bet.create({
        data: { userId: user.id, gameType: 'crash', amountLamports: 0n, payoutLamports: 0n },
      });
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(6_000n);
    expect(await prisma.bet.count({ where: { userId: user.id } })).toBe(1);
  });

  // ---- Real engine: crash settleRound() end-to-end ----

  function makeCrashEngine() {
    const gateway = { emitTick() {}, emitBust() {}, emitCreated() {} } as never;
    const chain = { enabled: false } as never;
    return new CrashEngine(prisma as never, gateway, chain);
  }

  function liveBet(userId: string, walletAddress: string, stake: bigint, payout: bigint) {
    return {
      userId,
      username: null,
      walletAddress,
      amountLamports: stake,
      originalAmountLamports: stake,
      payoutLamports: payout,
      autoCashout: null,
      cashedOutAt: payout > 0n ? 2 : null,
    };
  }

  it('crash settleRound: induced failure → zero partial effects, round not terminal, dead-letter written', async () => {
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });
    const u1 = await makeUser(0n); // already debited at bet time
    const missingUserId = randomUUID(); // valid uuid, no row → tx.user.update throws P2025

    const engine = makeCrashEngine();
    (engine as unknown as { current: unknown }).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      bustPoint: 2,
      phase: 'busted',
      startedAt: Date.now(),
      bets: new Map([
        [u1.id, liveBet(u1.id, 'w1', 1_000n, 2_000n)],
        [missingUserId, liveBet(missingUserId, 'w2', 1_000n, 0n)],
      ]),
    };

    const result = await (
      engine as unknown as { settleRound: () => Promise<unknown> }
    ).settleRound();

    expect(result).toBeNull(); // signalled failure → bust() won't advance the round

    // Zero partial effects: the valid user's balance is untouched, no rows.
    const u1After = await prisma.user.findUniqueOrThrow({ where: { id: u1.id } });
    expect(u1After.playBalanceLamports).toBe(0n);
    expect(await prisma.bet.count({ where: { userId: u1.id } })).toBe(0);
    expect(await prisma.crashBet.count({ where: { roundId: round.id } })).toBe(0);

    // Round NOT terminal, seed NOT revealed.
    const roundAfter = await prisma.crashRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(roundAfter.status).not.toBe('busted');
    const seedAfter = await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } });
    expect(seedAfter.revealedAt).toBeNull();

    // Dead-letter row persisted for the recovery worker.
    const dl = await prisma.settlementFailure.count({
      where: { gameType: 'crash', roundId: round.id },
    });
    expect(dl).toBe(1);
  });

  it('crash settleRound: happy path credits, writes rows, flips round + reveals seed atomically', async () => {
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });
    const winner = await makeUser(0n);
    const loser = await makeUser(0n);

    const engine = makeCrashEngine();
    (engine as unknown as { current: unknown }).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      bustPoint: 2,
      phase: 'busted',
      startedAt: Date.now(),
      bets: new Map([
        [winner.id, liveBet(winner.id, 'w1', 1_000n, 2_000n)], // cashed out 2x
        [loser.id, liveBet(loser.id, 'w2', 1_000n, 0n)], // rode to bust
      ]),
    };

    const result = (await (
      engine as unknown as { settleRound: () => Promise<{ settleJobs: unknown[] } | null> }
    ).settleRound()) as { settleJobs: unknown[] } | null;

    expect(result).not.toBeNull();
    expect(result!.settleJobs.length).toBe(2);

    const winnerAfter = await prisma.user.findUniqueOrThrow({ where: { id: winner.id } });
    expect(winnerAfter.playBalanceLamports).toBe(2_000n); // payout credited
    const loserAfter = await prisma.user.findUniqueOrThrow({ where: { id: loser.id } });
    expect(loserAfter.playBalanceLamports).toBe(0n);

    expect(await prisma.bet.count({ where: { userId: { in: [winner.id, loser.id] } } })).toBe(2);
    expect(await prisma.crashBet.count({ where: { roundId: round.id } })).toBe(2);

    const roundAfter = await prisma.crashRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(roundAfter.status).toBe('busted');
    const seedAfter = await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } });
    expect(seedAfter.revealedAt).not.toBeNull();
  });
});
