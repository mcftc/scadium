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
  RewardsService,
  DistributionService,
  BlockMiningService,
  VaultAccrualService,
  CustodyRuntime,
  DepositService,
  WithdrawalService,
  RedisService,
  queueConnection,
  QUEUE_NAMES,
  JOB_NAMES,
  runJob,
  type JobDeps,
  type JobPayload,
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
  const rewards = app.get(RewardsService, { strict: false });
  const distribution = app.get(DistributionService, { strict: false });
  const blockMining = app.get(BlockMiningService, { strict: false });
  const vaultAccrual = app.get(VaultAccrualService, { strict: false });
  const custody = app.get(CustodyRuntime, { strict: false });
  const deposits = app.get(DepositService, { strict: false });
  const withdrawals = app.get(WithdrawalService, { strict: false });
  const redis = app.get(RedisService, { strict: false });

  // Plain options object — each Queue/Worker spins its own BullMQ connection.
  const connection = queueConnection();

  // ---- consumers -----------------------------------------------------------
  // The job bodies live in @scadium/api's shared job registry, NOT here: the
  // Cloudflare Cron route (POST /internal/jobs/:name) drives the same handlers,
  // and two copies of money-moving logic would be a defect. This process supplies
  // the dependencies and the BullMQ plumbing; the registry supplies the behaviour.
  const deps: JobDeps = {
    airdrop,
    swap,
    leaderboard,
    reconciliation,
    rewards,
    distribution,
    blockMining,
    vaultAccrual,
    custody,
    deposits,
    withdrawals,
    redis,
  };

  const consumers = JOB_NAMES.map(
    (name) =>
      new Worker(name, async (job: Job) => runJob(name, deps, job.data as JobPayload), {
        connection,
      }),
  );

  for (const c of consumers) {
    c.on('failed', (job, err) =>
      logger.error(`${c.name} job ${job?.id ?? '?'} failed: ${err.message}`),
    );
    c.on('completed', (job) => logger.log(`${c.name} job ${job.id} done`));
  }

  // ---- schedulers (repeatable producers) -----------------------------------
  // upsertJobScheduler is idempotent by schedulerId, so restarting the worker
  // (or running N replicas) does not multiply the cadence.
  const airdropQueue = new Queue(QUEUE_NAMES.airdrop, { connection });
  const burnQueue = new Queue(QUEUE_NAMES.burn, { connection });
  const leaderboardQueue = new Queue(QUEUE_NAMES.leaderboard, { connection });
  const reconcileQueue = new Queue(QUEUE_NAMES.reconcile, { connection });
  const rewardClaimsQueue = new Queue(QUEUE_NAMES.rewardClaims, { connection });
  const lotteryPayoutsQueue = new Queue(QUEUE_NAMES.lotteryPayouts, { connection });
  const distributionQueue = new Queue(QUEUE_NAMES.distribution, { connection });
  const blockMiningQueue = new Queue(QUEUE_NAMES.blockMining, { connection });
  const vaultAccrualQueue = new Queue(QUEUE_NAMES.vaultAccrual, { connection });
  const custodyQueue = new Queue(QUEUE_NAMES.custody, { connection });

  await airdropQueue.upsertJobScheduler(
    'airdrop-hourly',
    { every: 5 * 60_000 },
    { name: 'distribute' },
  );
  await burnQueue.upsertJobScheduler('burn-10min', { every: 10 * 60_000 }, { name: 'burn' });
  await leaderboardQueue.upsertJobScheduler(
    'leaderboard-hourly',
    { every: 60 * 60_000 },
    { name: 'snapshot' },
  );
  await reconcileQueue.upsertJobScheduler(
    'reconcile-hourly',
    { every: 60 * 60_000 },
    { name: 'reconcile' },
  );
  await rewardClaimsQueue.upsertJobScheduler(
    'reward-claims-5min',
    { every: 5 * 60_000 },
    { name: 'sweep' },
  );
  await lotteryPayoutsQueue.upsertJobScheduler(
    'lottery-payouts-5min',
    { every: 5 * 60_000 },
    { name: 'sweep' },
  );
  // Run every 5 min to catch the top-of-hour boundary promptly; distribute() is
  // a no-op until an unsettled hour exists, so over-firing is cheap.
  await distributionQueue.upsertJobScheduler(
    'distribution-hourly',
    { every: 5 * 60_000 },
    { name: 'distribute' },
  );
  // Same cadence/rationale as distribution: accrue() is a no-op until an
  // unsettled hour exists, so over-firing every 5 min is cheap.
  await vaultAccrualQueue.upsertJobScheduler(
    'vault-accrual-hourly',
    { every: 5 * 60_000 },
    { name: 'accrue' },
  );
  // SCAD Engine v2 block mining — same cadence; mineBlock() is a no-op until an
  // unsettled hour exists.
  await blockMiningQueue.upsertJobScheduler(
    'block-mining-hourly',
    { every: 5 * 60_000 },
    { name: 'mine' },
  );

  // Custody: a deposit whose confirm call never arrived is credited within a
  // minute; the job returns at once while custody is inactive.
  await custodyQueue.upsertJobScheduler('custody-1min', { every: 60_000 }, { name: 'custody' });

  logger.log(`worker up — ${JOB_NAMES.length} queues, schedulers registered`);

  // Health endpoint so the worker can also run as a standalone "web service" on
  // hosts that require an open HTTP port. No-op locally / in docker-compose, and
  // in the Cloudflare container (PROCESS_MODE=both) where only the API binds.
  if (process.env.PORT) {
    const http = await import('node:http');
    http
      .createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      })
      .listen(Number(process.env.PORT), () => logger.log(`health on :${process.env.PORT}`));
  }

  const shutdown = async () => {
    logger.log('shutting down…');
    await Promise.allSettled(consumers.map((c) => c.close()));
    await Promise.allSettled(
      [
        airdropQueue,
        burnQueue,
        leaderboardQueue,
        reconcileQueue,
        rewardClaimsQueue,
        lotteryPayoutsQueue,
        distributionQueue,
        blockMiningQueue,
        vaultAccrualQueue,
        custodyQueue,
      ].map((q) => q.close()),
    );
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
