/**
 * Shared queue vocabulary — imported by BOTH the API (producer: e.g. the admin
 * `POST /airdrop/run` enqueue) and `@scadium/worker` (consumer/scheduler). Pure,
 * dependency-free so it is trivially unit-testable and safe to import anywhere.
 *
 * Idempotency is jobId-based: a timer-fire and an admin force for the SAME hour
 * both enqueue the same `jobId`, so BullMQ collapses them to one job. The money
 * paths additionally enforce idempotency at the data layer (the
 * `AirdropPool.distributed` flag + the `AirdropClaim @@unique([eventId,userId])`
 * constraint, and a Redis lock around buy-and-burn).
 */
export const QUEUE_NAMES = {
  airdrop: 'airdrop',
  burn: 'burn',
  leaderboard: 'leaderboard',
  reconcile: 'reconcile',
  /** #28: pending reward-claim reconcile sweep. */
  rewardClaims: 'reward-claims',
  /** #29: unpaid lottery prize sweep. */
  lotteryPayouts: 'lottery-payouts',
  /** SCAD Engine: hourly GGR→USDS staker dividend distribution round. */
  distribution: 'distribution',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * UTC hour period key `YYYYMMDDHH` for the hour containing `ms`. This is the
 * single definition shared by `AirdropEngine` and the airdrop jobId, so the
 * distribution the engine computes and the job the queue dedupes always agree.
 */
export function periodForHour(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}

/** 10-minute bucket index for the buy-and-burn cadence. */
export const tenMinuteBucket = (ms: number): number => Math.floor(ms / 600_000);

// ---- jobId builders (one per repeatable job) -------------------------------

export const airdropDistributeJobId = (period: string): string => `airdrop:distribute:${period}`;
export const burnJobId = (bucket: number): string => `burn:${bucket}`;
export const leaderboardJobId = (period: string, bucketTs: number): string =>
  `leaderboard:${period}:${bucketTs}`;
export const reconcileJobId = (bucketTs: number): string => `reconcile:${bucketTs}`;
export const distributionRoundJobId = (period: string): string => `distribution:${period}`;
