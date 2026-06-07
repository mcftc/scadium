import { Injectable } from '@nestjs/common';
import { LOTTERY, nextLotteryDrawAt } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CrashService } from '../games/crash/crash.service';
import { CoinflipService } from '../games/coinflip/coinflip.service';
import { BlackjackService } from '../games/blackjack/blackjack.service';
import { JackpotService } from '../games/jackpot/jackpot.service';

/**
 * Live platform counters for the header "Games" dropdown and the left-rail
 * "Total Bets" ticker (solpump shell). Aggregates each game's in-memory or
 * cheap-query state; the expensive total-bets count is cached for 60s.
 */
@Injectable()
export class PlatformService {
  private totalBetsCache: { value: number; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crash: CrashService,
    private readonly coinflip: CoinflipService,
    private readonly blackjack: BlackjackService,
    private readonly jackpot: JackpotService,
  ) {}

  async live() {
    const crashSnap = this.crash.snapshot() as { phase: string; multiplier: number };
    const [openFlips, jackpotCurrent, totalBets] = await Promise.all([
      this.coinflip.listOpen(50),
      this.jackpot.snapshot(),
      this.totalBets(),
    ]);
    const jp = jackpotCurrent as { players?: unknown[]; drawAt?: number | string | null } | null;
    const jackpotPlayers = jp?.players?.length ?? 0;

    return {
      crash: {
        phase: crashSnap.phase,
        multiplier: crashSnap.phase === 'running' ? crashSnap.multiplier : null,
      },
      coinflip: { openCount: openFlips.length },
      blackjack: { active: this.blackjack.activeCount() },
      jackpot: {
        status: jackpotPlayers > 0 ? 'open' : 'waiting',
        players: jackpotPlayers,
      },
      lottery: { drawAt: nextLotteryDrawAt(Date.now()), ticketPriceUsd: LOTTERY.TICKET_PRICE_USD },
      totalBets,
    };
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
