import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import {
  WorkerModule,
  AirdropEngine,
  SwapService,
  LeaderboardService,
  ReconciliationService,
  RedisService,
  queueConnection,
  withRedisLock,
  QUEUE_NAMES,
} from '@scadium/api';

/**
 * `@scadium/worker` — the durable background-job process (issue #11, Phase H).
 *
 * Boots the API's `WorkerModule` as a headless Nest context so it can call the
 * EXISTING engines/services (no duplicated logic), then runs one BullMQ consumer
 * per queue and schedules each job on a repeatable cadence. Idempotency is
 * layered: BullMQ jobId dedupe (admin-force vs scheduler) + data-layer guards
 * (`AirdropPool.distributed`, `AirdropClaim @@unique`) + a Redis lock around the
 * cosigner-spending buy-and-burn. Running ≥2 worker replicas is safe — duplicate
 * scheduled jobs collapse and the burn lock serializes.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: false });
  await app.init();

  const airdrop = app.get(AirdropEngine, { strict: false });
  const swap = app.get(SwapService, { strict: false });
  const leaderboard = app.get(LeaderboardService, { strict: false });
  const reconciliation = app.get(ReconciliationService, { strict: false });
  const redis = app.get(RedisService, { strict: false });

  // Plain options object — each Queue/Worker spins its own BullMQ connection.
  const connection = queueConnection();

  // ---- consumers -----------------------------------------------------------
  const consumers = [
    new Worker(
      QUEUE_NAMES.airdrop,
      // distribute() is idempotent: it only pays the just-ended hour once
      // (AirdropPool.distributed) and dedupes claims by (eventId,userId).
      async (job: Job) => airdrop.distribute(job.data?.forcedByUserId),
      { connection },
    ),
    new Worker(
      QUEUE_NAMES.burn,
      // Redis lock so two workers never read the same NGR window and
      // double-spend the cosigner. ttl < cadence so a crashed holder frees it.
      async () => {
        await withRedisLock(redis.client, 'lock:burn', 9 * 60_000, () => swap.runBuyAndBurn());
      },
      { connection },
    ),
    new Worker(QUEUE_NAMES.leaderboard, async () => leaderboard.snapshot('hourly'), { connection }),
    new Worker(QUEUE_NAMES.reconcile, async () => reconciliation.reconcileAll(), { connection }),
  ];
  for (const c of consumers) {
    c.on('failed', (job, err) => logger.error(`${c.name} job ${job?.id ?? '?'} failed: ${err.message}`));
    c.on('completed', (job) => logger.log(`${c.name} job ${job.id} done`));
  }

  // ---- schedulers (repeatable producers) -----------------------------------
  // upsertJobScheduler is idempotent by schedulerId, so restarting the worker
  // (or running N replicas) does not multiply the cadence.
  const airdropQueue = new Queue(QUEUE_NAMES.airdrop, { connection });
  const burnQueue = new Queue(QUEUE_NAMES.burn, { connection });
  const leaderboardQueue = new Queue(QUEUE_NAMES.leaderboard, { connection });
  const reconcileQueue = new Queue(QUEUE_NAMES.reconcile, { connection });

  await airdropQueue.upsertJobScheduler('airdrop-hourly', { every: 5 * 60_000 }, { name: 'distribute' });
  await burnQueue.upsertJobScheduler('burn-10min', { every: 10 * 60_000 }, { name: 'burn' });
  await leaderboardQueue.upsertJobScheduler('leaderboard-hourly', { every: 60 * 60_000 }, { name: 'snapshot' });
  await reconcileQueue.upsertJobScheduler('reconcile-hourly', { every: 60 * 60_000 }, { name: 'reconcile' });

  logger.log('worker up — 4 queues, schedulers registered');

  const shutdown = async () => {
    logger.log('shutting down…');
    await Promise.allSettled(consumers.map((c) => c.close()));
    await Promise.allSettled([airdropQueue, burnQueue, leaderboardQueue, reconcileQueue].map((q) => q.close()));
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

bootstrap().catch((err) => {
  console.error('worker failed to start:', err);
  process.exit(1);
});
