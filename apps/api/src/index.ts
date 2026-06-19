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
  airdropDistributeJobId,
  burnJobId,
  leaderboardJobId,
  reconcileJobId,
  distributionRoundJobId,
} from './queue/queue.constants';
export { queueConnection } from './queue/queue.connection';
export { withRedisLock } from './redis/redis-lock';
export { RedisService } from './redis/redis.service';
export { PrismaService } from './prisma/prisma.service';
export { AirdropEngine } from './airdrop/airdrop.engine';
export { SwapService } from './swap/swap.service';
export { LeaderboardService } from './leaderboard/leaderboard.service';
export { ReconciliationService } from './reconciliation/reconciliation.service';
export { RewardsService } from './rewards/rewards.service';
export { DistributionService } from './engine/distribution.service';
