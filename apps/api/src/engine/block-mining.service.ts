import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  ENGINE,
  SCAD,
  blockRewardFor,
  activePlayRate,
  blockShare,
  stakePlayRate,
  emissionPhaseFor,
} from '@scadium/shared';
import { sha256, jackpotWinningTicket, weightedWinnerIndex } from '@scadium/fair';
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

    const { start, end } = this.hourWindow(period);
    const { playRates, totalPlayRate } = await this.playRatesForWindow(start, end);

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

    // E4 — big-reward draw. A BIG_REWARD_BPS slice of the block goes to ONE
    // play-rate-weighted RANDOM winner (an equal-chance sweepstakes); the rest
    // is split pro-rata. Order participants deterministically so the draw is
    // reproducible from the revealed seed; a committed seed yields a uniform
    // ticket in [0, totalPlayRate) and the cumulative walk picks the winner.
    const bigReward = (reward * BigInt(ENGINE.BIG_REWARD_BPS)) / 10_000n;
    const splitPool = reward - bigReward;
    const ordered = [...playRates.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const serverSeed = randomBytes(32).toString('hex');
    const ticket = jackpotWinningTicket(serverSeed, period, 0, totalPlayRate);
    const winnerIdx = weightedWinnerIndex(
      ticket,
      ordered.map(([, w]) => w),
    );
    const winnerId = bigReward > 0n ? (ordered[winnerIdx]?.[0] ?? null) : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const block = await tx.engineBlock.upsert({
        where: { period },
        update: {},
        create: { period },
      });
      if (block.distributed) return noop; // raced — another worker settled it

      let minted = 0n;
      let participants = 0;
      for (const [userId, playRate] of ordered) {
        const share = blockShare(playRate, totalPlayRate, splitPool);
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

      // Award the big reward to the weighted-random winner (on top of their
      // pro-rata share — the "block finder" bonus).
      let bigMinted = 0n;
      if (winnerId && bigReward > 0n) {
        await applyBalanceDelta(tx, winnerId, bigReward, {
          currency: 'scad',
          reason: 'big_reward',
          refType: 'EngineBlock',
          refId: block.id,
        });
        bigMinted = bigReward;
      }
      minted += bigMinted;

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
          winnerId: bigMinted > 0n ? winnerId : null,
          bigRewardScad: bigMinted,
          drawSeed: serverSeed,
          drawSeedHash: sha256(serverSeed),
        },
      });

      return { period, rewardScad: minted.toString(), participantCount: participants };
    });

    this.logger.log(
      `block ${period}: minted ${result.rewardScad} SCAD to ${result.participantCount} miners (pool ${reward})`,
    );
    return result;
  }

  /**
   * Each miner's play-rate over a window: active (hourly wagered × tier, base
   * 1.0× for now) + passive (staked $SCAD — "savers keep mining", E6 tunes the
   * conversion). Shared by the worker (just-ended hour) and the read API
   * (current, in-progress hour).
   */
  private async playRatesForWindow(
    start: Date,
    end: Date,
  ): Promise<{ playRates: Map<string, bigint>; totalPlayRate: bigint }> {
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
    const stakers = await this.prisma.user.findMany({
      where: { scadiumStaked: { gt: 0n } },
      select: { id: true, scadiumStaked: true },
    });
    for (const s of stakers) {
      const pr = stakePlayRate(s.scadiumStaked);
      if (pr > 0n) playRates.set(s.id, (playRates.get(s.id) ?? 0n) + pr);
    }
    const totalPlayRate = [...playRates.values()].reduce((a, b) => a + b, 0n);
    return { playRates, totalPlayRate };
  }

  /** Engine emission (base units) so far, the remaining pool, and the phase. */
  private async emissionSnapshot() {
    const e = await this.prisma.emissionState.findUnique({ where: { id: EMISSION_SINGLETON_ID } });
    const emitted = e?.totalEmittedScad ?? 0n;
    const left = SCAD.P2E_POOL_BASE - emitted;
    return { emitted, remaining: left > 0n ? left : 0n, ...emissionPhaseFor(emitted) };
  }

  /** ms until the next top-of-hour block distribution. */
  private msToNextDistribution(now: number): number {
    return 3_600_000 - (now % 3_600_000);
  }

  /**
   * Engine-wide observability: halving phase + progress, total emitted, remaining
   * P2E pool, the current hourly block reward, the big-reward pot, and the
   * countdown to the next distribution. (`now` defaults to call time.)
   */
  async state(now = Date.now()) {
    const snap = await this.emissionSnapshot();
    const blockReward = blockRewardFor(snap.emitted);
    const bigReward = (blockReward * BigInt(ENGINE.BIG_REWARD_BPS)) / 10_000n;
    const lastBlock = await this.prisma.engineBlock.findFirst({
      where: { distributed: true },
      orderBy: { distributedAt: 'desc' },
      select: {
        period: true,
        rewardScad: true,
        participantCount: true,
        winnerId: true,
        bigRewardScad: true,
        distributedAt: true,
      },
    });
    return {
      phase: snap.phase,
      totalEmittedScad: snap.emitted.toString(),
      remainingPoolScad: snap.remaining.toString(),
      p2ePoolScad: SCAD.P2E_POOL_BASE.toString(),
      toNextHalvingScad: snap.toNextHalvingBase.toString(),
      currentBlockRewardScad: blockReward.toString(),
      bigRewardScad: bigReward.toString(),
      bigRewardBps: ENGINE.BIG_REWARD_BPS,
      msToNextDistribution: this.msToNextDistribution(now),
      lastBlock: lastBlock
        ? {
            period: lastBlock.period,
            rewardScad: lastBlock.rewardScad.toString(),
            participantCount: lastBlock.participantCount,
            winnerId: lastBlock.winnerId,
            bigRewardScad: lastBlock.bigRewardScad.toString(),
            distributedAt: lastBlock.distributedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  /**
   * A miner's live state for the CURRENT (in-progress) hour: their play-rate
   * (active + passive stake), the hour's total play-rate, and their projected
   * share of the current block reward if the hour ended now.
   */
  async minerState(userId: string, now = Date.now()) {
    const { start, end } = this.hourWindow(periodForHour(now));
    const { playRates, totalPlayRate } = await this.playRatesForWindow(start, end);
    const myPlayRate = playRates.get(userId) ?? 0n;
    const snap = await this.emissionSnapshot();
    const blockReward = blockRewardFor(snap.emitted);
    const splitPool = blockReward - (blockReward * BigInt(ENGINE.BIG_REWARD_BPS)) / 10_000n;
    const projectedShare = blockShare(myPlayRate, totalPlayRate, splitPool);
    return {
      playRate: myPlayRate.toString(),
      totalPlayRate: totalPlayRate.toString(),
      shareBps: totalPlayRate > 0n ? Number((myPlayRate * 10_000n) / totalPlayRate) : 0,
      projectedShareScad: projectedShare.toString(),
      mining: myPlayRate > 0n,
    };
  }

  /** Current-hour play-rate ranking (top miners), newest snapshot. */
  async currentLeaderboard(limit = 25, now = Date.now()) {
    const { start, end } = this.hourWindow(periodForHour(now));
    const { playRates, totalPlayRate } = await this.playRatesForWindow(start, end);
    const top = [...playRates.entries()]
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
      .slice(0, Math.min(Math.max(limit, 1), 100));
    const users = await this.prisma.user.findMany({
      where: { id: { in: top.map(([id]) => id) } },
      select: { id: true, username: true, walletAddress: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      totalPlayRate: totalPlayRate.toString(),
      miners: top.map(([id, pr], i) => ({
        rank: i + 1,
        userId: id,
        username: byId.get(id)?.username ?? null,
        walletAddress: byId.get(id)?.walletAddress ?? null,
        playRate: pr.toString(),
        shareBps: totalPlayRate > 0n ? Number((pr * 10_000n) / totalPlayRate) : 0,
      })),
    };
  }

  /** Recent blocks (newest first) for the engine feed, serialized. */
  async recentBlocks(limit = 30) {
    const blocks = await this.prisma.engineBlock.findMany({
      where: { distributed: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        period: true,
        rewardScad: true,
        totalPlayRate: true,
        participantCount: true,
        winnerId: true,
        bigRewardScad: true,
        drawSeed: true,
        drawSeedHash: true,
        distributedAt: true,
      },
    });
    return blocks.map((b) => ({
      period: b.period,
      rewardScad: b.rewardScad.toString(),
      totalPlayRate: b.totalPlayRate.toString(),
      participantCount: b.participantCount,
      winnerId: b.winnerId,
      bigRewardScad: b.bigRewardScad.toString(),
      drawSeed: b.drawSeed,
      drawSeedHash: b.drawSeedHash,
      distributedAt: b.distributedAt?.toISOString() ?? null,
    }));
  }

  /** Remaining P2E pool (base units) — for observability. */
  async remainingPool(): Promise<bigint> {
    return (await this.emissionSnapshot()).remaining;
  }
}
