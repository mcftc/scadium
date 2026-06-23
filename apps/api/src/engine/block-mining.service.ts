import { Injectable, Logger } from '@nestjs/common';
import { SCAD, blockRewardFor, activePlayRate, blockShare, stakePlayRate } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { periodForHour } from '../queue/queue.constants';

const EMISSION_SINGLETON_ID = 'singleton';

/**
 * SCAD Engine v2 — Proof-of-Play hourly mining (E2).
 *
 * Each UTC hour is a "block". The block reward is the current halving phase's
 * subsidy (`blockRewardFor`, from the 500M P2E pool) and is split across the
 * hour's miners by PLAY-RATE share — lamports wagered that hour (+ a passive
 * contribution from staked $SCAD, E6). $SCAD is minted ONLY here (the per-bet
 * mint is removed in E3), so this is the single emission authority.
 *
 * Idempotency mirrors DistributionService: one `EngineBlock` per `period`,
 * settled once via the `distributed` guard, so a re-fire never double-mints.
 * The emission cap (`SCAD.P2E_POOL_BASE`) is enforced by `blockRewardFor`
 * clamping to what's left, and the mint + `EmissionState` bump commit together.
 */
@Injectable()
export class BlockMiningService {
  private readonly logger = new Logger(BlockMiningService.name);

  constructor(private readonly prisma: PrismaService) {}

  private hourWindow(period: string): { start: Date; end: Date } {
    const start = new Date(
      Date.parse(
        `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}T${period.slice(8, 10)}:00:00Z`,
      ),
    );
    return { start, end: new Date(start.getTime() + 3_600_000) };
  }

  /**
   * Mine the block for the hour that just ended (or, when forced mid-hour in
   * dev, the current hour). Safe to call repeatedly — a settled block returns
   * immediately.
   */
  async mineBlock(): Promise<{ period: string; rewardScad: string; participantCount: number }> {
    const period = periodForHour(Date.now() - 60_000);
    const noop = { period, rewardScad: '0', participantCount: 0 };

    const existing = await this.prisma.engineBlock.findUnique({ where: { period } });
    if (existing?.distributed) return noop;

    // Current cumulative emission → this block's (phase-halved, pool-clamped) reward.
    const emission = await this.prisma.emissionState.findUnique({
      where: { id: EMISSION_SINGLETON_ID },
    });
    const emitted = emission?.totalEmittedScad ?? 0n;
    const reward = blockRewardFor(emitted);

    // Each miner's play-rate this hour: active (hourly wagered × tier) + passive
    // (staked $SCAD). Tier multiplier is the base 1.0× for now (per-user tiers
    // can refine it later); staking passive lands in E6 but the term is wired in.
    const { start, end } = this.hourWindow(period);
    const wagers = await this.prisma.bet.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: start, lt: end } },
      _sum: { amountLamports: true },
    });

    const playRates = new Map<string, bigint>();
    for (const w of wagers) {
      const pr = activePlayRate(w._sum.amountLamports ?? 0n);
      if (pr > 0n) playRates.set(w.userId, pr);
    }

    // Passive play-rate from stakers (continuity — "savers keep mining"). E6
    // tunes this; included here so the single split covers both.
    const stakers = await this.prisma.user.findMany({
      where: { scadiumStaked: { gt: 0n } },
      select: { id: true, scadiumStaked: true },
    });
    for (const s of stakers) {
      const pr = stakePlayRate(s.scadiumStaked);
      if (pr > 0n) playRates.set(s.id, (playRates.get(s.id) ?? 0n) + pr);
    }

    const totalPlayRate = [...playRates.values()].reduce((a, b) => a + b, 0n);

    // Nothing to mine (pool exhausted, or no play this hour) → settle an empty
    // block so it is never retried.
    if (reward <= 0n || totalPlayRate <= 0n || playRates.size === 0) {
      await this.prisma.engineBlock.upsert({
        where: { period },
        update: { distributed: true, distributedAt: new Date(), rewardScad: 0n, totalPlayRate },
        create: {
          period,
          distributed: true,
          distributedAt: new Date(),
          rewardScad: 0n,
          totalPlayRate,
        },
      });
      this.logger.log(`block ${period}: no mint (reward=${reward}, totalPlayRate=${totalPlayRate})`);
      return noop;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const block = await tx.engineBlock.upsert({
        where: { period },
        update: {},
        create: { period },
      });
      if (block.distributed) return noop; // raced — another worker settled it

      let minted = 0n;
      let participants = 0;
      for (const [userId, playRate] of playRates) {
        const share = blockShare(playRate, totalPlayRate, reward);
        if (share <= 0n) continue;
        await tx.engineBlockShare.create({
          data: { blockId: block.id, userId, playRate, shareScad: share },
        });
        await applyBalanceDelta(tx, userId, share, {
          currency: 'scad',
          reason: 'block_reward',
          refType: 'EngineBlock',
          refId: block.id,
        });
        minted += share;
        participants += 1;
      }

      // Advance the single emission cursor by exactly what was minted, atomically
      // with the credits (so the P2E cap stays enforceable).
      await tx.emissionState.upsert({
        where: { id: EMISSION_SINGLETON_ID },
        create: { id: EMISSION_SINGLETON_ID, totalEmittedScad: minted },
        update: { totalEmittedScad: { increment: minted } },
      });

      await tx.engineBlock.update({
        where: { id: block.id },
        data: {
          distributed: true,
          distributedAt: new Date(),
          rewardScad: minted,
          totalPlayRate,
          participantCount: participants,
        },
      });

      return { period, rewardScad: minted.toString(), participantCount: participants };
    });

    this.logger.log(
      `block ${period}: minted ${result.rewardScad} SCAD to ${result.participantCount} miners (pool ${reward})`,
    );
    return result;
  }

  /** Recent blocks (newest first) for the engine feed (E5 expands this). */
  async recentBlocks(limit = 30) {
    return this.prisma.engineBlock.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  /** Remaining P2E pool (base units) — for observability. */
  async remainingPool(): Promise<bigint> {
    const e = await this.prisma.emissionState.findUnique({ where: { id: EMISSION_SINGLETON_ID } });
    const left = SCAD.P2E_POOL_BASE - (e?.totalEmittedScad ?? 0n);
    return left > 0n ? left : 0n;
  }
}
