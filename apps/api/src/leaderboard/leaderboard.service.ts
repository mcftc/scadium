import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
      where: { banned: false, totalWagered: { gt: 0 } },
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
      where: { banned: false },
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
}
