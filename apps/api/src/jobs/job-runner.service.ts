import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { QueueName } from '../queue/queue.constants';
import { AirdropEngine } from '../airdrop/airdrop.engine';
import { SwapService } from '../swap/swap.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { RewardsService } from '../rewards/rewards.service';
import { DistributionService } from '../engine/distribution.service';
import { BlockMiningService } from '../engine/block-mining.service';
import { VaultAccrualService } from '../vault/vault-accrual.service';
import { RedisService } from '../redis/redis.service';
import { runJob, type JobDeps, type JobPayload } from './job-registry';

/**
 * Resolves the job dependencies out of the running Nest graph and runs a job
 * from the shared registry.
 *
 * Uses `ModuleRef.get(..., { strict: false })` — the same mechanism
 * `@scadium/worker` uses to reach these services — so the feature modules do not
 * have to re-export anything for this route to exist. Resolution is lazy and
 * cached so a boot is never failed by this non-critical route.
 */
@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);
  private deps?: JobDeps;

  constructor(private readonly moduleRef: ModuleRef) {}

  private resolve(): JobDeps {
    if (!this.deps) {
      const get = <T>(t: new (...args: never[]) => T): T =>
        this.moduleRef.get(t, { strict: false });
      this.deps = {
        airdrop: get(AirdropEngine),
        swap: get(SwapService),
        leaderboard: get(LeaderboardService),
        reconciliation: get(ReconciliationService),
        rewards: get(RewardsService),
        distribution: get(DistributionService),
        blockMining: get(BlockMiningService),
        vaultAccrual: get(VaultAccrualService),
        redis: get(RedisService),
      };
    }
    return this.deps;
  }

  /** Run one job synchronously and report how long it took. */
  async run(name: QueueName, payload?: JobPayload): Promise<{ job: string; durationMs: number }> {
    const started = Date.now();
    this.logger.log(`internal job '${name}' starting`);
    await runJob(name, this.resolve(), payload);
    const durationMs = Date.now() - started;
    this.logger.log(`internal job '${name}' done in ${durationMs}ms`);
    return { job: name, durationMs };
  }
}
