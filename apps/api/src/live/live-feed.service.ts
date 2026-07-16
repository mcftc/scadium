import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LiveFeedGateway } from './live-feed.gateway';
import type { LiveBetEvent, LiveFeedPublisher, SettledBetInput } from './live-feed.types';

/** first4…last4 — enough to recognise a wallet without exposing it. */
function shortWallet(addr: string): string {
  return addr.length <= 10 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

interface CachedDisplay {
  player: string;
  avatarUrl: string | null;
  at: number;
}

/**
 * Sitewide live-bet feed producer (#roadmap-4). Every game's settlement calls
 * `publishSettledBet` (fire-and-forget); this resolves a PII-safe display handle
 * (cached), broadcasts a `live:bet` event over the `/live` gateway, and keeps a
 * small in-memory ring of the most recent events. The durable initial list for
 * the web ticker comes from `recentBets()` (a DB query), so the ring is only a
 * hot-path convenience, not the source of truth.
 */
@Injectable()
export class LiveFeedService implements LiveFeedPublisher {
  private readonly logger = new Logger(LiveFeedService.name);
  private readonly ring: LiveBetEvent[] = [];
  private static readonly RING_CAP = 60;
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
    const { player, avatarUrl } = await this.resolveDisplay(input.userId);
    const event: LiveBetEvent = {
      id: input.betId,
      gameType: input.gameType,
      player,
      avatarUrl,
      amountLamports: input.amountLamports.toString(),
      payoutLamports: input.payoutLamports.toString(),
      multiplier: input.multiplier,
      won: input.won,
      at: input.at ?? Date.now(),
    };
    this.ring.unshift(event);
    if (this.ring.length > LiveFeedService.RING_CAP) this.ring.length = LiveFeedService.RING_CAP;
    this.gateway.broadcast(event);
  }

  private async resolveDisplay(userId: string): Promise<{ player: string; avatarUrl: string | null }> {
    const now = Date.now();
    const hit = this.display.get(userId);
    if (hit && now - hit.at < LiveFeedService.DISPLAY_TTL_MS) {
      return { player: hit.player, avatarUrl: hit.avatarUrl };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, avatarUrl: true, walletAddress: true },
    });
    const player = user?.username ?? (user ? shortWallet(user.walletAddress) : 'anon');
    const avatarUrl = user?.avatarUrl ?? null;
    // Simple bound: clear the cache when it grows too large (cheap, rare).
    if (this.display.size >= LiveFeedService.DISPLAY_CAP) this.display.clear();
    this.display.set(userId, { player, avatarUrl, at: now });
    return { player, avatarUrl };
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
        user: { select: { username: true, avatarUrl: true, walletAddress: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      gameType: r.gameType,
      player: r.user.username ?? shortWallet(r.user.walletAddress),
      avatarUrl: r.user.avatarUrl ?? null,
      amountLamports: r.amountLamports.toString(),
      payoutLamports: r.payoutLamports.toString(),
      multiplier: r.multiplier ?? null,
      won: r.status === 'won',
      at: r.createdAt.getTime(),
    }));
  }
}
