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
  const rewards = app.get(RewardsService, { strict: false });
  const distribution = app.get(DistributionService, { strict: false });
  const blockMining = app.get(BlockMiningService, { strict: false });
  const vaultAccrual = app.get(VaultAccrualService, { strict: false });
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
    new Worker(
      QUEUE_NAMES.reconcile,
      // #30: the solvency monitor rides the reconcile cadence — gauge + alert
      // when house_vault drops under rent floor + buffer.
      async () => {
        await reconciliation.reconcileAll();
        await reconciliation.houseSolvency();
        // SCAD Engine: spendable + staked $SCAD ledger drift + USDS solvency.
        await reconciliation.scadLedgerDrift();
        await reconciliation.stakeLedgerDrift();
        await reconciliation.usdsSolvency();
      },
      { connection },
    ),
    new Worker(
      QUEUE_NAMES.lotteryPayouts,
      // #29: pay_prize retry sweep — Payout PDA per (draw,winner) backstops
      // double-pays; solvency-budgeted per run.
      async () => reconciliation.sweepLotteryPrizes(),
      { connection },
    ),
    new Worker(
      QUEUE_NAMES.rewardClaims,
      // #28: sweep pending claims — every transition is status-guarded and the
      // on-chain ClaimRecord PDA blocks double-pays, so N workers are safe.
      async () => rewards.reconcilePendingClaims(),
      { connection },
    ),
    new Worker(
      QUEUE_NAMES.distribution,
      // SCAD Engine: hourly GGR→USDS staker dividend. Idempotent per hour
      // (DistributionRound.period unique + distributed flag + DistributionClaim
      // @@unique), but a Redis lock still serializes the staker-credit loop so
      // two replicas don't both walk it.
      async () => {
        await withRedisLock(redis.client, 'lock:distribution', 9 * 60_000, () =>
          distribution.distribute(),
        );
      },
      { connection },
    ),
    new Worker(
      QUEUE_NAMES.blockMining,
      // SCAD Engine v2: hourly Proof-of-Play block mint. Idempotent per hour
      // (EngineBlock.period unique + distributed flag + EngineBlockShare
      // @@unique); a Redis lock serializes the per-miner credit loop so two
      // replicas don't both walk it.
      async () => {
        await withRedisLock(redis.client, 'lock:block-mining', 9 * 60_000, () =>
          blockMining.mineBlock(),
        );
      },
      { connection },
    ),
    new Worker(
      QUEUE_NAMES.vaultAccrual,
      // SCAD Vault: hourly NGR→$SCAD term-pool yield. Idempotent per hour
      // (VaultAccrualRound.period unique + distributed flag); a Redis lock still
      // serializes the per-pool index updates so two replicas don't both walk it.
      async () => {
        await withRedisLock(redis.client, 'lock:vault-accrual', 9 * 60_000, () =>
          vaultAccrual.accrue(),
        );
      },
      { connection },
    ),
  ];
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

  logger.log('worker up — 9 queues, schedulers registered');

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
