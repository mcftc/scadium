import { Injectable, Optional } from '@nestjs/common';
import { LOTTERY, nextLotteryDrawAt } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CrashService } from '../games/crash/crash.service';
import { CoinflipService } from '../games/coinflip/coinflip.service';
import { BlackjackService } from '../games/blackjack/blackjack.service';
import { JackpotService } from '../games/jackpot/jackpot.service';
import { gameEnabled } from '../games/enabled-games';

/**
 * Live platform counters for the header "Games" dropdown and the left-rail
 * "Total Bets" ticker (solpump shell). Aggregates each game's in-memory or
 * cheap-query state; the expensive total-bets count is cached for 60s.
 */
@Injectable()
export class PlatformService {
  private totalBetsCache: { value: number; at: number } | null = null;

  /**
   * Every game service is @Optional().
   *
   * Games are registered conditionally from ENABLED_GAMES (see
   * games/enabled-games.ts), so a disabled game's service simply does not exist
   * in the container. Without @Optional() this constructor could not be
   * resolved and the whole API would fail to BOOT — not 404 a route, fail to
   * start — the moment a game was switched off.
   */
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly crash?: CrashService,
    @Optional() private readonly coinflip?: CoinflipService,
    @Optional() private readonly blackjack?: BlackjackService,
    @Optional() private readonly jackpot?: JackpotService,
  ) {}

  /**
   * Live counters for the header dropdown and the "Total Bets" ticker.
   *
   * Only reports on games that are actually enabled: a disabled game's key is
   * absent rather than null, so the web app can render its menu straight from
   * the response without a second source of truth about the roster.
   */
  async live() {
    const [openFlips, jackpotCurrent, totalBets] = await Promise.all([
      this.coinflip?.countOpen() ?? Promise.resolve(0),
      this.jackpot?.snapshot() ?? Promise.resolve(null),
      this.totalBets(),
    ]);

    const live: Record<string, unknown> = { totalBets };

    if (this.crash) {
      const snap = this.crash.snapshot() as { phase: string; multiplier: number };
      live.crash = {
        phase: snap.phase,
        multiplier: snap.phase === 'running' ? snap.multiplier : null,
      };
    }
    if (this.coinflip) live.coinflip = { openCount: openFlips };
    if (this.blackjack) live.blackjack = { active: this.blackjack.activeCount() };
    if (this.jackpot) {
      const jp = jackpotCurrent as { players?: unknown[] } | null;
      const players = jp?.players?.length ?? 0;
      live.jackpot = { status: players > 0 ? 'open' : 'waiting', players };
    }
    // Lottery has no service dependency here — its next draw is pure maths — so
    // it is gated on the catalogue rather than on an injected instance.
    if (gameEnabled('lottery')) {
      live.lottery = {
        drawAt: nextLotteryDrawAt(Date.now()),
        ticketPriceUsd: LOTTERY.TICKET_PRICE_USD,
      };
    }

    return live;
  }

  private async totalBets(): Promise<number> {
    const now = Date.now();
    if (this.totalBetsCache && now - this.totalBetsCache.at < 60_000) {
      return this.totalBetsCache.value;
    }
    const value = await this.prisma.bet.count();
    this.totalBetsCache = { value, at: now };
    return value;
  }
}
