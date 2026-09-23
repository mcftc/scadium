import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { displayHandle } from '../common/public-player';
import { LiveFeedGateway } from './live-feed.gateway';
import type { LiveBetEvent, LiveFeedPublisher, SettledBetInput } from './live-feed.types';

interface CachedDisplay {
  player: string;
  at: number;
}

/**
 * Sitewide live-bet feed producer (#roadmap-4). Every game's settlement calls
 * `publishSettledBet` (fire-and-forget); this resolves a PII-safe display handle
 * (cached) and broadcasts a `live:bet` event over the `/live` gateway. The
 * durable initial list for the web ticker comes from `recentBets()` (a DB
 * query), which is the source of truth.
 */
@Injectable()
export class LiveFeedService implements LiveFeedPublisher {
  private readonly logger = new Logger(LiveFeedService.name);
  private readonly display = new Map<string, CachedDisplay>();
  private static readonly DISPLAY_TTL_MS = 5 * 60_000;
  private static readonly DISPLAY_CAP = 5_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveFeedGateway,
  ) {}

  /**
   * Fire-and-forget: returns void immediately and does the async resolve +
   * broadcast on a detached promise. A failure is logged, never thrown — the
   * feed must never affect the settlement that produced the bet.
   */
  publishSettledBet(input: SettledBetInput): void {
    void this.doPublish(input).catch((err) => {
      this.logger.warn(`live-feed publish failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  private async doPublish(input: SettledBetInput): Promise<void> {
    const player = await this.resolveDisplay(input.userId);
    const event: LiveBetEvent = {
      id: input.betId,
      gameType: input.gameType,
      player,
      amountLamports: input.amountLamports.toString(),
      payoutLamports: input.payoutLamports.toString(),
      multiplier: input.multiplier,
      won: input.won,
      at: input.at ?? Date.now(),
    };
    this.gateway.broadcast(event);
  }

  private async resolveDisplay(userId: string): Promise<string> {
    const now = Date.now();
    const hit = this.display.get(userId);
    if (hit && now - hit.at < LiveFeedService.DISPLAY_TTL_MS) return hit.player;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, walletAddress: true },
    });
    const player = user ? displayHandle(user) : 'anon';
    // Simple bound: clear the cache when it grows too large (cheap, rare).
    if (this.display.size >= LiveFeedService.DISPLAY_CAP) this.display.clear();
    this.display.set(userId, { player, at: now });
    return player;
  }

  /**
   * Recent settled bets across all games for the initial ticker load. DB-backed
   * (durable across restart) and PII-safe. `onlyWins` powers a "big wins" view.
   */
  async recentBets(limit: number, onlyWins = false): Promise<LiveBetEvent[]> {
    const rows = await this.prisma.bet.findMany({
      where: onlyWins ? { status: 'won' } : { status: { in: ['won', 'lost'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        gameType: true,
        amountLamports: true,
        payoutLamports: true,
        multiplier: true,
        status: true,
        createdAt: true,
        user: { select: { username: true, walletAddress: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      gameType: r.gameType,
      player: displayHandle(r.user),
      amountLamports: r.amountLamports.toString(),
      payoutLamports: r.payoutLamports.toString(),
      multiplier: r.multiplier ?? null,
      won: r.status === 'won',
      at: r.createdAt.getTime(),
    }));
  }
}
