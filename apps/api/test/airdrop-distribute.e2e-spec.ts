import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { AirdropEngine } from '../src/airdrop/airdrop.engine';
import { queueConnection } from '../src/queue/queue.connection';
import { airdropDistributeJobId, periodForHour } from '../src/queue/queue.constants';
import { prisma, gw } from './engine-harness';

/**
 * Issue #11 — enqueuing the airdrop distribution TWICE for the same hour (the
 * scheduler tick + an admin force) must pay the pool EXACTLY ONCE. Two guards
 * combine: BullMQ collapses the duplicate jobId, and the engine's
 * `AirdropPool.distributed` flag + `AirdropClaim @@unique([eventId,userId])`
 * make a second execution a no-op. Proven against real Redis + Postgres.
 */
describe('airdrop distribute — enqueue twice, pay once (issue #11)', () => {
  const engine = new AirdropEngine(prisma as never, gw());
  const queueName = `airdrop-test-${randomUUID()}`;
  const connection = queueConnection();
  const queue = new Queue(queueName, { connection });
  let worker: Worker;

  afterAll(async () => {
    if (worker) await worker.close().catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
  });

  it('pays the pool once across two duplicate-jobId enqueues', async () => {
    // The hour the engine will distribute = the one that just ended.
    const period = periodForHour(Date.now() - 60_000);
    const hourStart = new Date(Math.floor((Date.now() - 60_000) / 3_600_000) * 3_600_000);
    const inHour = new Date(hourStart.getTime() + 5 * 60_000);

    // Fresh, undistributed pool for that hour.
    await prisma.airdropPool.deleteMany({ where: { period } });
    const base = 1_000_000n;
    await prisma.airdropPool.create({ data: { period, baseLamports: base } });

    // Two eligible users: ≥ 0.001 SOL wagered AND ≥ 1 chat in the hour.
    const startBal = 10_000_000n;
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      const u = await prisma.user.create({
        data: {
          walletAddress: `ad-${id}`,
          refCode: `ad-ref-${id}`,
          playBalanceLamports: startBal,
        },
      });
      ids.push(u.id);
      await prisma.bet.create({
        data: { userId: u.id, gameType: 'crash', amountLamports: 2_000_000n, createdAt: inHour },
      });
      await prisma.chatMessage.create({ data: { userId: u.id, body: 'gm', createdAt: inHour } });
    }

    // Enqueue twice with the SAME period jobId BEFORE starting the consumer, so
    // BullMQ dedupes; the data-layer guard is the backstop if both ever run.
    const jobId = airdropDistributeJobId(period);
    await queue.add('distribute', {}, { jobId });
    await queue.add('distribute', {}, { jobId });

    let processed = 0;
    worker = new Worker(
      queueName,
      async () => {
        await engine.distribute();
        processed += 1;
      },
      { connection },
    );

    // Wait until both eligible users have exactly one claim each.
    const deadline = Date.now() + 15_000;
    let claims = 0;
    while (Date.now() < deadline) {
      claims = await prisma.airdropClaim.count({ where: { userId: { in: ids } } });
      if (claims >= 2) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Exactly one claim per user (no double-credit), and each balance rose by
    // exactly that one claim's amount. We read the actual claim lamports rather
    // than assume base/2 — the shared test DB may hold other eligible users from
    // prior runs, which only changes the share size, never the once-only credit.
    expect(await prisma.airdropClaim.count({ where: { userId: { in: ids } } })).toBe(2);
    for (const id of ids) {
      const userClaims = await prisma.airdropClaim.findMany({ where: { userId: id } });
      expect(userClaims).toHaveLength(1);
      const u = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(u.playBalanceLamports).toBe(startBal + userClaims[0]!.lamports);
    }
    // The pool is marked distributed; a duplicate run would have no-op'd.
    const pool = await prisma.airdropPool.findUniqueOrThrow({ where: { period } });
    expect(pool.distributed).toBe(true);
    expect(processed).toBeGreaterThanOrEqual(1);
  });
});
