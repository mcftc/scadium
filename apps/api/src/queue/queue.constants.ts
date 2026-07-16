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
  /** SCAD Vault: hourly NGR→$SCAD term-pool yield accrual round. */
  vaultAccrual: 'vault-accrual',
  /** SCAD Engine v2: hourly Proof-of-Play block-reward mining round. */
  blockMining: 'block-mining',
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

/**
 * UTC `YYYYMMDDHH` key of the most recently COMPLETED clock hour at `ms`.
 *
 * Hourly settle jobs (airdrop pool, staker dividends, block mining, vault
 * accrual) MUST target this, not `periodForHour(now)` — the worker fires them
 * every ~5 minutes, so settling the in-progress hour would lock in only the
 * first minutes of NGR/play-rate and, for the airdrop, reject the rest of the
 * hour's tips (#H11). At 10:05 → the 09:00 hour; exactly at 10:00:00 → 09:00.
 */
export function lastCompletedHourPeriod(ms: number): string {
  const startOfCurrentHour = ms - (ms % 3_600_000);
  return periodForHour(startOfCurrentHour - 1);
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
export const vaultAccrualJobId = (period: string): string => `vault-accrual:${period}`;
export const blockMiningJobId = (period: string): string => `block-mining:${period}`;
