import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEMO_BOT_IDS } from '../games/bots/demo-bots.const';

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
