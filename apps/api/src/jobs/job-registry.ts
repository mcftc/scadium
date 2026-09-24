import { QUEUE_NAMES, type QueueName, lastCompletedDayPeriod } from '../queue/queue.constants';
import { withRedisLock } from '../redis/redis-lock';
import type { RedisService } from '../redis/redis.service';
import type { AirdropEngine } from '../airdrop/airdrop.engine';
import type { SwapService } from '../swap/swap.service';
import type { LeaderboardService } from '../leaderboard/leaderboard.service';
import type { ReconciliationService } from '../reconciliation/reconciliation.service';
import type { RewardsService } from '../rewards/rewards.service';
import type { DistributionService } from '../engine/distribution.service';
import type { BlockMiningService } from '../engine/block-mining.service';
import type { VaultAccrualService } from '../vault/vault-accrual.service';
import type { CustodyRuntime } from '../custody/custody-runtime';
import type { DepositService } from '../custody/deposit.service';
import type { WithdrawalService } from '../custody/withdrawal.service';

/**
 * The economy and custody jobs, defined ONCE.
 *
 * Two callers drive these, and neither owns the logic:
 *   1. `@scadium/worker`'s BullMQ consumers, while the process is awake.
 *   2. `POST /internal/jobs/:name` (see `jobs.controller.ts`), called by a
 *      Cloudflare Cron Trigger — the scheduling guarantee once the container is
 *      allowed to sleep. See `docs/superpowers/specs/2026-09-20-cloudflare-migration-design.md` §5.2.
 *
 * Before this registry existed the bodies lived inline in the worker's consumer
 * array; a second caller would have meant copy-pasting them, so they were
 * extracted rather than duplicated.
 *
 * Every handler is idempotent and period-keyed at the data layer, so the two
 * callers firing for the same period collapse to one effect. That is what makes
 * it safe to run both paths at once.
 */
export interface JobDeps {
  airdrop: AirdropEngine;
  swap: SwapService;
  leaderboard: LeaderboardService;
  reconciliation: ReconciliationService;
  rewards: RewardsService;
  distribution: DistributionService;
  blockMining: BlockMiningService;
  vaultAccrual: VaultAccrualService;
  custody: CustodyRuntime;
  deposits: DepositService;
  withdrawals: WithdrawalService;
  redis: RedisService;
}

/** Optional job input. `forcedByUserId` flows to the airdrop audit row. */
export interface JobPayload {
  forcedByUserId?: string;
}

export type JobHandler = (deps: JobDeps, payload?: JobPayload) => Promise<void>;

/**
 * Lock TTL for the cosigner-spending / ledger-walking jobs. Shorter than the
 * cadence so a crashed holder frees it before the next fire.
 */
const LOCK_TTL_MS = 9 * 60_000;

export const JOB_HANDLERS: Record<QueueName, JobHandler> = {
  // distribute() is idempotent: it only pays the just-ended hour once
  // (AirdropPool.distributed) and dedupes claims by (eventId,userId).
  [QUEUE_NAMES.airdrop]: async ({ airdrop }, payload) => {
    await airdrop.distribute(payload?.forcedByUserId);
  },

  // Redis lock so two workers never read the same NGR window and double-spend
  // the cosigner.
  [QUEUE_NAMES.burn]: async ({ swap, redis }) => {
    await withRedisLock(redis.client, 'lock:burn', LOCK_TTL_MS, () => swap.runBuyAndBurn());
  },

  [QUEUE_NAMES.leaderboard]: async ({ leaderboard, redis }) => {
    await leaderboard.snapshot('hourly');
    // Daily race: settle the last COMPLETED UTC day. Idempotent (the RaceResult
    // unique guard pays each winner once) + locked so replicas don't duplicate
    // the work; safe to run hourly — it pays once when the day first completes,
    // then no-ops.
    await withRedisLock(redis.client, 'lock:race-settle', LOCK_TTL_MS, () =>
      leaderboard.settleRace(lastCompletedDayPeriod(Date.now())),
    );
  },

  // #30: the solvency monitor rides the reconcile cadence.
  [QUEUE_NAMES.reconcile]: async ({ reconciliation }) => {
    await reconciliation.reconcileAll();
    await reconciliation.houseSolvency();
    await reconciliation.scadLedgerDrift();
    await reconciliation.stakeLedgerDrift();
    await reconciliation.usdsSolvency();
    await reconciliation.custodySolvency();
  },

  // #29: pay_prize retry sweep — the Payout PDA per (draw,winner) backstops
  // double-pays; solvency-budgeted per run.
  [QUEUE_NAMES.lotteryPayouts]: async ({ reconciliation }) => {
    await reconciliation.sweepLotteryPrizes();
  },

  // #28: sweep pending claims — every transition is status-guarded and the
  // on-chain ClaimRecord PDA blocks double-pays, so N callers are safe.
  [QUEUE_NAMES.rewardClaims]: async ({ rewards }) => {
    await rewards.reconcilePendingClaims();
  },

  // SCAD Engine: hourly GGR→USDS staker dividend. Idempotent per hour
  // (DistributionRound.period unique + distributed flag + DistributionClaim
  // @@unique); the lock still serializes the staker-credit loop.
  [QUEUE_NAMES.distribution]: async ({ distribution, redis }) => {
    await withRedisLock(redis.client, 'lock:distribution', LOCK_TTL_MS, () =>
      distribution.distribute(),
    );
  },

  // SCAD Engine v2: hourly Proof-of-Play block mint. Idempotent per hour
  // (EngineBlock.period unique + distributed flag + EngineBlockShare @@unique).
  [QUEUE_NAMES.blockMining]: async ({ blockMining, redis }) => {
    await withRedisLock(redis.client, 'lock:block-mining', LOCK_TTL_MS, () =>
      blockMining.mineBlock(),
    );
  },

  // SCAD Vault: hourly NGR→$SCAD term-pool yield. Idempotent per hour
  // (VaultAccrualRound.period unique + distributed flag); the lock serializes
  // the per-pool index updates.
  [QUEUE_NAMES.vaultAccrual]: async ({ vaultAccrual, redis }) => {
    await withRedisLock(redis.client, 'lock:vault-accrual', LOCK_TTL_MS, () =>
      vaultAccrual.accrue(),
    );
  },

  // Custody (ADR 0005): record deposits whose confirm call never arrived, retry
  // held ones, and move unfinished withdrawals on. Idempotent (unique signature,
  // CAS transitions); the lock keeps replicas from walking the same history.
  [QUEUE_NAMES.custody]: async ({ custody, deposits, withdrawals, redis }) => {
    if (!custody.active) return;
    await withRedisLock(redis.client, 'lock:custody', LOCK_TTL_MS, async () => {
      await deposits.scan();
      await withdrawals.resumeAll();
    });
  },
};

/** Every queue name that has a handler — the job names the cron endpoint accepts. */
export const JOB_NAMES = Object.keys(JOB_HANDLERS) as QueueName[];

/** Narrow an untrusted path parameter to a known job name. */
export function isJobName(name: string): name is QueueName {
  return Object.prototype.hasOwnProperty.call(JOB_HANDLERS, name);
}

/** Run one job by name. Throws if the name is unknown (callers narrow first). */
export async function runJob(
  name: QueueName,
  deps: JobDeps,
  payload?: JobPayload,
): Promise<void> {
  const handler = JOB_HANDLERS[name];
  if (!handler) throw new Error(`unknown job '${name}'`);
  await handler(deps, payload);
}
