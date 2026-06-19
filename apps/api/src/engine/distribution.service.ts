import { Injectable, Logger } from '@nestjs/common';
import { ENGINE, dividendPoolUsdsBase } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { periodForHour } from '../queue/queue.constants';

/**
 * SCAD Engine — hourly GGR dividend distribution (bc.game's "distribution
 * rounds", adapted).
 *
 * Each round covers one UTC hour. The NGR (wagered − paid out) over that hour is
 * converted to a USDS pool (ENGINE.DIVIDEND_NGR_BPS of NGR) and split pro-rata
 * across all staked $SCAD balances at distribution time, credited as USDS.
 *
 * Idempotency mirrors the airdrop engine: one `DistributionRound` per `period`
 * (unique) guarded by its `distributed` flag, and `DistributionClaim
 * @@unique([roundId, userId])`. The window is the FIXED hour (not "since last
 * run"), so a given hour's NGR is stable and a re-fire pays nothing twice. This
 * is independent of buy-and-burn (which spends cosigner SOL over its own
 * window) — each takes its own bps slice of NGR; they never contend.
 */
@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Hour window [start, end) for a `YYYYMMDDHH` period key. */
  private hourWindow(period: string): { start: Date; end: Date } {
    const start = new Date(
      Date.parse(
        `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}T${period.slice(8, 10)}:00:00Z`,
      ),
    );
    return { start, end: new Date(start.getTime() + 3_600_000) };
  }

  /**
   * Run the distribution round for the hour that just ended (or, when forced
   * mid-hour in dev, the current hour). Safe to call repeatedly: a settled round
   * returns immediately.
   */
  async distribute(): Promise<{ period: string; participantCount: number; poolUsds: string }> {
    const period = periodForHour(Date.now() - 60_000);
    const noop = { period, participantCount: 0, poolUsds: '0' };

    // One round row per hour; if it's already settled, stop.
    const existing = await this.prisma.distributionRound.findUnique({ where: { period } });
    if (existing?.distributed) return noop;

    const { start, end } = this.hourWindow(period);
    const agg = await this.prisma.bet.aggregate({
      where: { createdAt: { gte: start, lt: end } },
      _sum: { amountLamports: true, payoutLamports: true },
    });
    const stakes = agg._sum.amountLamports ?? 0n;
    const payouts = agg._sum.payoutLamports ?? 0n;
    const ngr = stakes - payouts;
    const poolUsds = dividendPoolUsdsBase(ngr);

    // Snapshot eligible stakers (anyone with a positive staked balance).
    const stakers = await this.prisma.user.findMany({
      where: { scadiumStaked: { gt: 0n } },
      select: { id: true, scadiumStaked: true },
    });
    const totalStaked = stakers.reduce((a, s) => a + s.scadiumStaked, 0n);

    // Nothing to pay → still settle the round (so it's not retried forever) with
    // a zero pool. Covers: non-positive NGR, dust pool, or no stakers.
    if (
      poolUsds < BigInt(ENGINE.MIN_DIVIDEND_POOL_USDS_BASE) ||
      stakers.length === 0 ||
      totalStaked <= 0n
    ) {
      await this.prisma.distributionRound.upsert({
        where: { period },
        update: {
          distributed: true,
          distributedAt: new Date(),
          ngrLamports: ngr,
          poolUsds: 0n,
          totalStakedSnapshot: totalStaked,
          participantCount: 0,
        },
        create: {
          period,
          distributed: true,
          distributedAt: new Date(),
          ngrLamports: ngr,
          poolUsds: 0n,
          totalStakedSnapshot: totalStaked,
          participantCount: 0,
        },
      });
      this.logger.log(
        `distribution ${period}: no payout (ngr=${ngr}, pool=${poolUsds}, stakers=${stakers.length})`,
      );
      return noop;
    }

    // Pro-rata split. Integer math: any sub-unit remainder stays unallocated
    // (negligible USDS dust), so the sum of shares never exceeds the pool.
    await this.prisma.$transaction(async (tx) => {
      // Re-check + claim the round atomically (upsert + distributed guard).
      const round = await tx.distributionRound.upsert({
        where: { period },
        update: {},
        create: { period },
      });
      if (round.distributed) return; // raced — another worker settled it

      let paid = 0;
      for (const s of stakers) {
        const share = (poolUsds * s.scadiumStaked) / totalStaked;
        if (share <= 0n) continue;
        await tx.distributionClaim.create({
          data: { roundId: round.id, userId: s.id, stakedAmount: s.scadiumStaked, shareUsds: share },
        });
        await applyBalanceDelta(tx, s.id, share, {
          currency: 'usds',
          reason: 'dividend_credit',
          refType: 'DistributionRound',
          refId: round.id,
        });
        paid += 1;
      }

      await tx.distributionRound.update({
        where: { id: round.id },
        data: {
          distributed: true,
          distributedAt: new Date(),
          ngrLamports: ngr,
          poolUsds,
          totalStakedSnapshot: totalStaked,
          participantCount: paid,
        },
      });
    });

    this.logger.log(
      `distribution ${period}: ${poolUsds} USDS → ${stakers.length} stakers (ngr=${ngr})`,
    );
    return { period, participantCount: stakers.length, poolUsds: poolUsds.toString() };
  }

  /** Recent distribution rounds (newest first) for the engine UI. */
  async recentRounds(limit = 30) {
    const rows = await this.prisma.distributionRound.findMany({
      where: { distributed: true },
      orderBy: { distributedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((r) => ({
      period: r.period,
      ngrLamports: r.ngrLamports.toString(),
      poolUsds: r.poolUsds.toString(),
      totalStakedSnapshot: r.totalStakedSnapshot.toString(),
      participantCount: r.participantCount,
      distributedAt: r.distributedAt?.toISOString() ?? null,
    }));
  }

  /** Engine-wide stats for the dashboard header (supply/burn/staked/dividends). */
  async engineStats() {
    const [stakedAgg, burnAgg, distAgg, lastRound] = await Promise.all([
      this.prisma.user.aggregate({ _sum: { scadiumStaked: true } }),
      this.prisma.tokenBurn.aggregate({ _sum: { scadBurned: true } }),
      this.prisma.distributionRound.aggregate({ _sum: { poolUsds: true } }),
      this.prisma.distributionRound.findFirst({
        where: { distributed: true },
        orderBy: { distributedAt: 'desc' },
        select: { period: true, poolUsds: true, participantCount: true, distributedAt: true },
      }),
    ]);
    return {
      totalStakedScad: (stakedAgg._sum.scadiumStaked ?? 0n).toString(),
      totalBurnedScad: (burnAgg._sum.scadBurned ?? 0n).toString(),
      totalDistributedUsds: (distAgg._sum.poolUsds ?? 0n).toString(),
      dividendNgrBps: ENGINE.DIVIDEND_NGR_BPS,
      buybackNgrBps: ENGINE.BUYBACK_NGR_BPS,
      distributionIntervalMs: ENGINE.DISTRIBUTION_INTERVAL_MS,
      lastRound: lastRound
        ? {
            period: lastRound.period,
            poolUsds: lastRound.poolUsds.toString(),
            participantCount: lastRound.participantCount,
            distributedAt: lastRound.distributedAt?.toISOString() ?? null,
          }
        : null,
    };
  }
}
