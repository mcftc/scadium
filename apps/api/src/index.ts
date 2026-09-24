/**
 * Public surface of `@scadium/api` consumed by `@scadium/worker`. The worker
 * boots `WorkerModule` and resolves these service classes from the Nest context
 * to drive them on a BullMQ schedule — reusing the exact same logic the API runs
 * (no duplication). Queue vocabulary + the Redis lock are shared from here too.
 */
export { WorkerModule } from './worker/worker.module';
export { QueueModule } from './queue/queue.module';
export { QueueService } from './queue/queue.service';
export {
  QUEUE_NAMES,
  type QueueName,
  periodForHour,
  tenMinuteBucket,
  lastCompletedDayPeriod,
  airdropDistributeJobId,
  burnJobId,
  leaderboardJobId,
  reconcileJobId,
  distributionRoundJobId,
} from './queue/queue.constants';
export { queueConnection } from './queue/queue.connection';
// The economy + custody jobs, defined once and shared by BOTH drivers: the worker's
// BullMQ consumers and the cron-called POST /internal/jobs/:name route.
export {
  JOB_HANDLERS,
  JOB_NAMES,
  isJobName,
  runJob,
  type JobDeps,
  type JobHandler,
  type JobPayload,
} from './jobs/job-registry';
export { withRedisLock } from './redis/redis-lock';
export { RedisService } from './redis/redis.service';
export { PrismaService } from './prisma/prisma.service';
export { AirdropEngine } from './airdrop/airdrop.engine';
export { SwapService } from './swap/swap.service';
export { LeaderboardService } from './leaderboard/leaderboard.service';
export { ReconciliationService } from './reconciliation/reconciliation.service';
export { CustodyRuntime } from './custody/custody-runtime';
export { DepositService } from './custody/deposit.service';
export { WithdrawalService } from './custody/withdrawal.service';
export { RewardsService } from './rewards/rewards.service';
export { DistributionService } from './engine/distribution.service';
export { BlockMiningService } from './engine/block-mining.service';
export { VaultAccrualService } from './vault/vault-accrual.service';
