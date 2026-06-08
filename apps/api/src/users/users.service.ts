import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { GameType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { StatsWindow } from './dto/stats-query.dto';

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
    input: {
      username?: string;
      avatarUrl?: string;
      email?: string;
      notifyEmailWins?: boolean;
      notifyMarketing?: boolean;
    },
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

  /** Link or unlink a social account. `account` empty/null clears the link. */
  async updateConnection(
    id: string,
    provider: 'google' | 'telegram' | 'discord',
    account: string | null,
  ): Promise<ReturnType<UsersService['serializeUser']>> {
    const col =
      provider === 'google'
        ? 'googleAccount'
        : provider === 'telegram'
          ? 'telegramAccount'
          : 'discordAccount';
    const value = account && account.trim() ? account.trim() : null;
    const user = await this.prisma.user.update({ where: { id }, data: { [col]: value } });
    return this.serializeUser(user);
  }

  /**
   * Paginated bet history. Uses cursor pagination for stable ordering even
   * as new bets stream in. The cursor is the `createdAt` of the last row;
   * `id` is used as a tiebreaker within the same millisecond.
   */
  async listBets(
    userId: string,
    params: { limit?: number; cursor?: string; gameType?: GameType },
  ) {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const bets = await this.prisma.bet.findMany({
      where: { userId, ...(params.gameType ? { gameType: params.gameType } : {}) },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });

    const hasMore = bets.length > limit;
    const rows = hasMore ? bets.slice(0, limit) : bets;

    // Bet.seedId is a loose FK (no Prisma relation) — fetch the referenced
    // seeds in one query so each row can expose the provably-fair inputs for
    // a /fairness verify deep-link.
    const seedIds = [...new Set(rows.map((b) => b.seedId).filter((id): id is string => !!id))];
    const seeds = seedIds.length
      ? await this.prisma.seed.findMany({
          where: { id: { in: seedIds } },
          select: { id: true, clientSeed: true, serverSeed: true, serverSeedHash: true },
        })
      : [];
    const seedById = new Map(seeds.map((s) => [s.id, s]));

    return {
      items: rows.map((b) => {
        const seed = b.seedId ? seedById.get(b.seedId) : undefined;
        return {
          id: b.id,
          gameType: b.gameType,
          amountLamports: b.amountLamports.toString(),
          payoutLamports: b.payoutLamports.toString(),
          multiplier: b.multiplier,
          status: b.status,
          txSignature: b.txSignature,
          createdAt: b.createdAt.toISOString(),
          resultJson: b.resultJson,
          nonce: b.nonce,
          seed: seed
            ? {
                clientSeed: seed.clientSeed,
                serverSeed: seed.serverSeed,
                serverSeedHash: seed.serverSeedHash,
              }
            : null,
        };
      }),
      nextCursor: hasMore ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Aggregate stats for a time window, always computed from the Bet table so
   * every window (and `biggestWin`) stays consistent — the denormalized User
   * columns omit `biggestWin` for some games. For a user with N bets this is
   * a single indexed aggregate on (userId, createdAt). 'all' spans every bet
   * (or everything since the user's last "Reset Stats").
   */
  async getStats(userId: string, window: StatsWindow = 'all') {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { statsResetAt: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const since = windowCutoff(window, user.statsResetAt);
    const agg = await this.prisma.bet.aggregate({
      where: { userId, ...(since ? { createdAt: { gte: since } } : {}) },
      _sum: { amountLamports: true, payoutLamports: true },
      _max: { payoutLamports: true },
      _count: true,
    });
    const wagered = agg._sum.amountLamports ?? BigInt(0);
    const paid = agg._sum.payoutLamports ?? BigInt(0);
    return {
      window,
      totalWageredLamports: wagered.toString(),
      netLamports: (paid - wagered).toString(),
      biggestWinLamports: (agg._max.payoutLamports ?? BigInt(0)).toString(),
      gamesPlayed: agg._count,
    };
  }

  /** "Reset Stats" — the lifetime grid counts only bets after this instant. */
  async resetStats(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { statsResetAt: new Date() } });
    return { ok: true as const };
  }

  private serializeUser(user: {
    id: string;
    walletAddress: string;
    username: string | null;
    avatarUrl: string | null;
    email: string | null;
    googleAccount: string | null;
    telegramAccount: string | null;
    discordAccount: string | null;
    notifyEmailWins: boolean;
    notifyMarketing: boolean;
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
      email: user.email,
      connections: {
        google: user.googleAccount,
        telegram: user.telegramAccount,
        discord: user.discordAccount,
      },
      prefs: { emailWins: user.notifyEmailWins, marketing: user.notifyMarketing },
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
/** Lower time bound for a stats window; 'all' falls back to the reset mark. */
function windowCutoff(window: StatsWindow, statsResetAt: Date | null): Date | null {
  const DAY = 86_400_000;
  const now = Date.now();
  switch (window) {
    case '24h':
      return new Date(now - DAY);
    case '7d':
      return new Date(now - 7 * DAY);
    case '1m':
      return new Date(now - 30 * DAY);
    case 'all':
      return statsResetAt;
  }
}

export function xpInfo(totalWageredLamports: bigint) {
  const xp = Number(totalWageredLamports / BigInt(100_000)); // 1e9 lamports → 10,000 XP
  const level = Math.floor(Math.sqrt(xp / 100));
  const currentFloor = 100 * level * level;
  const nextAt = 100 * (level + 1) * (level + 1);
  return { xp, level, xpCurrentLevelFloor: currentFloor, xpNextLevelAt: nextAt };
}
