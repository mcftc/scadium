import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RACE, racePrizeLamports } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DEMO_BOT_IDS } from '../games/bots/demo-bots.const';
import { withSerializable } from '../prisma/with-serializable';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { dayPeriodStartMs } from '../queue/queue.constants';

const DAY_MS = 86_400_000;
const WINDOW_CACHE_MS = 30_000;
const EXCLUDE_CACHE_MS = 60_000;

/** UTC midnight of the day containing `ms`. */
const startOfUtcDayMs = (ms: number): number => ms - (ms % DAY_MS);
/** UTC Monday-00:00 of the ISO week containing `ms`. */
const startOfIsoWeekMs = (ms: number): number => {
  const dow = (new Date(ms).getUTCDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  return startOfUtcDayMs(ms) - dow * DAY_MS;
};

export interface WindowEntry {
  rank: number;
  userId: string;
  username: string | null;
  walletAddress: string;
  volumeLamports: string;
}

// Demo bots (DEMO_BOTS=1) play every game with a huge balance; keep them off the
// public leaderboards so they don't top every board.
const EXCLUDE_BOTS = { notIn: [...DEMO_BOT_IDS] };

/**
 * Leaderboard queries. For now aggregates directly from the User table's
 * cumulative stats. A cron-snapshot-based leaderboard (writing to
 * LeaderboardSnapshot hourly/daily) is a later optimization once query
 * volume warrants it.
 */
@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly logger = new Logger(LeaderboardService.name);
  private windowCache = new Map<string, { rows: WindowEntry[]; at: number }>();
  private excludeCache: { ids: string[]; at: number } | null = null;

  async topByVolume(limit = 50) {
    const users = await this.prisma.user.findMany({
      where: { banned: false, totalWagered: { gt: 0 }, id: EXCLUDE_BOTS },
      orderBy: { totalWagered: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        username: true,
        walletAddress: true,
        totalWagered: true,
        totalWon: true,
        gamesPlayed: true,
      },
    });
    return users.map((u, i) => ({
      rank: i + 1,
      userId: u.id,
      username: u.username,
      walletAddress: u.walletAddress,
      volumeLamports: u.totalWagered.toString(),
      profitLamports: u.totalWon.toString(),
      gamesPlayed: u.gamesPlayed,
    }));
  }

  async topByProfit(limit = 50) {
    const users = await this.prisma.user.findMany({
      where: { banned: false, id: EXCLUDE_BOTS },
      orderBy: { totalWon: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        username: true,
        walletAddress: true,
        totalWagered: true,
        totalWon: true,
        gamesPlayed: true,
      },
    });
    return users.map((u, i) => ({
      rank: i + 1,
      userId: u.id,
      username: u.username,
      walletAddress: u.walletAddress,
      volumeLamports: u.totalWagered.toString(),
      profitLamports: u.totalWon.toString(),
      gamesPlayed: u.gamesPlayed,
    }));
  }

  /**
   * Bots + banned users — kept off every public board/race. Cached briefly for
   * the read paths; `fresh` bypasses the cache so the money settle can't credit a
   * user banned within the last cache window.
   */
  private async excludedUserIds(fresh = false): Promise<string[]> {
    const now = Date.now();
    if (!fresh && this.excludeCache && now - this.excludeCache.at < EXCLUDE_CACHE_MS) {
      return this.excludeCache.ids;
    }
    const banned = await this.prisma.user.findMany({
      where: { banned: true },
      select: { id: true },
    });
    const ids = [...DEMO_BOT_IDS, ...banned.map((b) => b.id)];
    this.excludeCache = { ids, at: now };
    return ids;
  }

  /**
   * Top wagerers by volume within a time window (the daily/weekly boards + the
   * race read from here). Sums `amountLamports` over settled Bet rows in the
   * window per user, excludes bots/banned, joins display fields. `end` is
   * exclusive; omit it for an open-ended "since window start" board.
   */
  private async topByWindowVolume(
    start: Date,
    end: Date | undefined,
    limit: number,
    freshExclude = false,
  ): Promise<WindowEntry[]> {
    const exclude = await this.excludedUserIds(freshExclude);
    const grouped = await this.prisma.bet.groupBy({
      by: ['userId'],
      where: {
        createdAt: end ? { gte: start, lt: end } : { gte: start },
        status: { in: ['won', 'lost'] },
        userId: { notIn: exclude },
      },
      _sum: { amountLamports: true },
      // Secondary key so a volume tie at the payout boundary is deterministic
      // across runs (the settle standings must be reproducible).
      orderBy: [{ _sum: { amountLamports: 'desc' } }, { userId: 'asc' }],
      take: limit,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: { id: true, username: true, walletAddress: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return grouped.map((g, i) => {
      const u = byId.get(g.userId);
      return {
        rank: i + 1,
        userId: g.userId,
        username: u?.username ?? null,
        walletAddress: u?.walletAddress ?? '',
        volumeLamports: (g._sum.amountLamports ?? BigInt(0)).toString(),
      };
    });
  }

  /** Daily (UTC day) or weekly (UTC ISO week) board by wagered volume. Cached. */
  async windowedTop(
    period: 'daily' | 'weekly',
    limit: number = RACE.BOARD_SIZE,
  ): Promise<WindowEntry[]> {
    const key = `${period}:${limit}`;
    const hit = this.windowCache.get(key);
    if (hit && Date.now() - hit.at < WINDOW_CACHE_MS) return hit.rows;
    const now = Date.now();
    const start = period === 'daily' ? startOfUtcDayMs(now) : startOfIsoWeekMs(now);
    const rows = await this.topByWindowVolume(new Date(start), undefined, limit);
    this.windowCache.set(key, { rows, at: now });
    return rows;
  }

  /**
   * Live daily-race standings: today's top wagerers with the prize each rank
   * would win from the fixed pool, plus the pool total and the UTC-midnight
   * reset. Prizes are indicative until the day completes and `settleRace` pays.
   */
  async raceStandings(limit: number = RACE.BOARD_SIZE) {
    const entries = await this.windowedTop('daily', limit);
    return {
      resetAt: startOfUtcDayMs(Date.now()) + DAY_MS,
      poolLamports: BigInt(RACE.DAILY_POOL_LAMPORTS).toString(),
      prizeRanks: RACE.PAYOUT_BPS.length,
      entries: entries.map((e) => ({
        ...e,
        prizeLamports: racePrizeLamports(e.rank - 1).toString(),
      })),
    };
  }

  /**
   * Settle a COMPLETED UTC day's race: pay each of the top wagerers their prize
   * from the fixed pool into the play balance (ledgered). Idempotent — the
   * `RaceResult` row create (unique on `[raceDay, userId]`) is the guarded claim
   * BEFORE the credit, so a re-run (or a concurrent settle across replicas) pays
   * each winner at most once. Only ranks within the payout curve earn.
   */
  async settleRace(raceDay: string): Promise<{ raceDay: string; paid: number; totalLamports: string }> {
    const dayStart = dayPeriodStartMs(raceDay);
    // Fresh exclude (bypass the 60s cache) — the money settle must not pay a user
    // banned in the last minute before the run.
    const winners = await this.topByWindowVolume(
      new Date(dayStart),
      new Date(dayStart + DAY_MS),
      RACE.PAYOUT_BPS.length,
      true,
    );
    let paid = 0;
    let total = BigInt(0);
    // NO fast-path on "already has rows": the per-user `RaceResult` unique guard
    // makes the WHOLE loop idempotent AND self-healing — a re-run skips winners
    // already paid (P2002) and pays any a prior INTERRUPTED run missed (partial
    // settle). Each winner is isolated in its own try, so one failure (e.g. a
    // P2025 from a user deleted between the read and the credit) can't strand the
    // others or block recovery.
    for (const w of winners) {
      const prize = racePrizeLamports(w.rank - 1);
      if (prize <= BigInt(0)) continue;
      try {
        const credited = await withSerializable(this.prisma, async (tx) => {
          let rr: { id: string };
          try {
            rr = await tx.raceResult.create({
              data: {
                raceDay,
                userId: w.userId,
                rank: w.rank,
                volumeLamports: BigInt(w.volumeLamports),
                prizeLamports: prize,
              },
              select: { id: true },
            });
          } catch (e) {
            // Already paid this user for this day (concurrent settle / re-run) —
            // no further statement runs on the aborted tx, so it clean-rolls back.
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              return false;
            }
            throw e;
          }
          await applyBalanceDelta(tx, w.userId, prize, {
            reason: 'race_prize',
            refType: 'RaceResult',
            refId: rr.id,
          });
          return true;
        });
        if (credited) {
          paid += 1;
          total += prize;
        }
      } catch (e) {
        this.logger.error(
          `race settle ${raceDay}: failed to pay rank ${w.rank} (${w.userId}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return { raceDay, paid, totalLamports: total.toString() };
  }

  /**
   * Materialize a windowed leaderboard into `LeaderboardSnapshot` (driven by the
   * worker on a cadence). Each call captures the current top-by-volume ranking
   * for `period` ('hourly'|'daily'|'weekly') as one batch sharing `capturedAt`,
   * so a windowed board reads the latest captured batch instead of recomputing
   * live `User` aggregates on every request. Returns the number of rows written.
   */
  async snapshot(period: 'hourly' | 'daily' | 'weekly' = 'hourly', limit = 100): Promise<number> {
    const top = await this.topByVolume(limit);
    if (top.length === 0) return 0;
    const capturedAt = new Date();
    await this.prisma.leaderboardSnapshot.createMany({
      data: top.map((r) => ({
        period,
        userId: r.userId,
        volumeLamports: BigInt(r.volumeLamports),
        rank: r.rank,
        capturedAt,
      })),
    });
    return top.length;
  }

  /** Latest captured batch for a windowed board (most recent `capturedAt`). */
  async latestSnapshot(period: 'hourly' | 'daily' | 'weekly') {
    const newest = await this.prisma.leaderboardSnapshot.findFirst({
      where: { period },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true },
    });
    if (!newest) return [];
    return this.prisma.leaderboardSnapshot.findMany({
      where: { period, capturedAt: newest.capturedAt },
      orderBy: { rank: 'asc' },
    });
  }
}
