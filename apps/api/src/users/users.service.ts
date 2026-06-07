import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read/write operations on the authenticated user's profile.
 *
 * All bigints are serialized to strings on the wire so the JSON payload
 * stays within JS number safety and matches the shared type contracts in
 * @scadium/shared.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.serializeUser(user);
  }

  async updateProfile(
    id: string,
    input: { username?: string; avatarUrl?: string },
  ): Promise<ReturnType<UsersService['serializeUser']>> {
    // Username collision check (the DB unique index will still catch races)
    if (input.username) {
      const taken = await this.prisma.user.findUnique({
        where: { username: input.username },
      });
      if (taken && taken.id !== id) {
        throw new ConflictException('Username already taken');
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: input,
    });
    return this.serializeUser(user);
  }

  /**
   * Paginated bet history. Uses cursor pagination for stable ordering even
   * as new bets stream in. The cursor is the `createdAt` of the last row;
   * `id` is used as a tiebreaker within the same millisecond.
   */
  async listBets(userId: string, params: { limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const bets = await this.prisma.bet.findMany({
      where: { userId },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });

    const hasMore = bets.length > limit;
    const rows = hasMore ? bets.slice(0, limit) : bets;

    return {
      items: rows.map((b) => ({
        id: b.id,
        gameType: b.gameType,
        amountLamports: b.amountLamports.toString(),
        payoutLamports: b.payoutLamports.toString(),
        multiplier: b.multiplier,
        status: b.status,
        txSignature: b.txSignature,
        createdAt: b.createdAt.toISOString(),
        resultJson: b.resultJson,
      })),
      nextCursor: hasMore ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  async getStats(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return {
      totalWageredLamports: user.totalWagered.toString(),
      totalWonLamports: user.totalWon.toString(),
      totalLostLamports: user.totalLost.toString(),
      biggestWinLamports: user.biggestWin.toString(),
      gamesPlayed: user.gamesPlayed,
      netLamports: (user.totalWon - user.totalLost).toString(),
    };
  }

  private serializeUser(user: {
    id: string;
    walletAddress: string;
    username: string | null;
    avatarUrl: string | null;
    role: 'user' | 'moderator' | 'admin';
    refCode: string;
    referredById: string | null;
    banned: boolean;
    totalWagered: bigint;
    totalWon: bigint;
    totalLost: bigint;
    biggestWin: bigint;
    gamesPlayed: number;
    scadiumBalance: bigint;
    playBalanceLamports: bigint;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      walletAddress: user.walletAddress,
      username: user.username,
      avatarUrl: user.avatarUrl,
      role: user.role,
      refCode: user.refCode,
      referredBy: user.referredById,
      banned: user.banned,
      createdAt: user.createdAt.toISOString(),
      stats: {
        totalWageredLamports: user.totalWagered.toString(),
        totalWonLamports: user.totalWon.toString(),
        totalLostLamports: user.totalLost.toString(),
        biggestWinLamports: user.biggestWin.toString(),
        gamesPlayed: user.gamesPlayed,
      },
      scadiumBalance: user.scadiumBalance.toString(),
      playBalanceLamports: user.playBalanceLamports.toString(),
      ...xpInfo(user.totalWagered),
    };
  }
}

/**
 * XP/level (solpump-style) derived purely from lifetime wager — no extra
 * column to maintain. 1 SOL wagered = 10,000 XP; the cumulative threshold
 * for level L is 100·L², so levels come quickly at first and stretch out.
 * Exported so chat (level badges) shares the exact same derivation.
 */
export function xpInfo(totalWageredLamports: bigint) {
  const xp = Number(totalWageredLamports / BigInt(100_000)); // 1e9 lamports → 10,000 XP
  const level = Math.floor(Math.sqrt(xp / 100));
  const currentFloor = 100 * level * level;
  const nextAt = 100 * (level + 1) * (level + 1);
  return { xp, level, xpCurrentLevelFloor: currentFloor, xpNextLevelAt: nextAt };
}
