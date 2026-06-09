import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LOTTERY } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainService } from '../../solana/chain.service';
import { LotteryEngine } from './lottery.engine';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { claimIdempotency, storeIdempotency } from '../../prisma/idempotency';

/**
 * HTTP-facing facade for the lottery. Validates ticket picks, debits the
 * play-money balance, persists the ticket, and registers it with the engine.
 * The debit is pessimistic (taken at purchase) so balance can't be double-spent.
 */
@Injectable()
export class LotteryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: LotteryEngine,
    private readonly chain: ChainService,
  ) {}

  snapshot() {
    return this.engine.snapshot();
  }

  async forceDraw(userId: string) {
    await this.assertAdmin(userId);
    return this.engine.forceDraw();
  }

  private async assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role !== 'admin') throw new ForbiddenException('Admin access required');
  }

  /**
   * On-chain purchase confirmation (Phase E): the web buys via a USER-signed
   * buy_ticket transaction, then posts the signature here. We fetch the tx,
   * decode the TicketBought event, and only then persist the ticket — the
   * chain is the source of truth, the API cannot be tricked into recording
   * a ticket that wasn't paid for.
   */
  async confirmTicket(params: { userId: string; signature: string }) {
    if (!this.chain.lotteryEnabled) {
      throw new BadRequestException('On-chain lottery is not enabled');
    }
    const open = this.engine.getOpenDraw();
    if (!open) throw new BadRequestException('No open draw');

    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('Account banned');

    // One tx can carry many tickets (`buy_tickets` batch) — one event each.
    const events = await this.chain.verifyTicketTx(params.signature);
    if (events.length === 0) {
      throw new BadRequestException('Transaction not found or not a ticket purchase');
    }
    for (const event of events) {
      if (event.buyer !== user.walletAddress) {
        throw new BadRequestException('Ticket was bought by a different wallet');
      }
      if (event.drawIndex !== open.drawIndex) {
        throw new BadRequestException('Ticket belongs to a different draw');
      }
    }

    const price = BigInt(LOTTERY.TICKET_PRICE_LAMPORTS);
    // @@unique([txSignature, txIndex]) makes replaying a signature impossible —
    // createMany throws on the duplicate key before anything is recorded.
    const tickets = await this.prisma.$transaction(
      events.map((event, txIndex) =>
        this.prisma.lotteryTicket.create({
          data: {
            drawId: open.id,
            userId: params.userId,
            mainNumbers: [...event.main].sort((a, b) => a - b),
            bonusNumber: event.bonus,
            costLamports: price,
            txSignature: params.signature,
            txIndex,
          },
        }),
      ),
    );
    await this.engine.onTicketSold(price, tickets.length);

    return {
      txSignature: params.signature,
      count: tickets.length,
      tickets: tickets.map((t) => ({
        id: t.id,
        drawId: t.drawId,
        mainNumbers: t.mainNumbers,
        bonusNumber: t.bonusNumber,
      })),
    };
  }

  /**
   * Wager-loyalty free tickets: every 1 SOL of lifetime wager (any game)
   * earns one. Consuming a ticket advances the watermark by 1 SOL.
   */
  async freeTicketStatus(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const per = BigInt(LOTTERY.FREE_TICKET_PER_WAGER_LAMPORTS);
    const available = Number((user.totalWagered - user.freeTicketBaselineWagered) / per);
    const progress = Number((user.totalWagered - user.freeTicketBaselineWagered) % per);
    return {
      available: Math.max(0, available),
      progressLamports: progress.toString(),
      perWagerLamports: per.toString(),
    };
  }

  /** Spend one earned free ticket on the caller's picks (no USDT moves). */
  async useFreeTicket(params: { userId: string; mainNumbers: number[]; bonusNumber: number }) {
    const distinct = new Set(params.mainNumbers);
    if (distinct.size !== LOTTERY.MAIN_COUNT) {
      throw new BadRequestException('Main numbers must be 5 distinct values');
    }
    const open = this.engine.getOpenDraw();
    if (!open) throw new BadRequestException('No open draw');

    const per = BigInt(LOTTERY.FREE_TICKET_PER_WAGER_LAMPORTS);
    const ticket = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: params.userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.banned) throw new ForbiddenException('Account banned');
      if (user.totalWagered - user.freeTicketBaselineWagered < per) {
        throw new BadRequestException('No free tickets earned yet — wager 1 SOL to earn one');
      }
      await tx.user.update({
        where: { id: params.userId },
        data: { freeTicketBaselineWagered: { increment: per } },
      });
      return tx.lotteryTicket.create({
        data: {
          drawId: open.id,
          userId: params.userId,
          mainNumbers: [...params.mainNumbers].sort((a, b) => a - b),
          bonusNumber: params.bonusNumber,
          costLamports: BigInt(0),
          free: true,
        },
      });
    });
    await this.engine.onTicketSold(BigInt(0));
    return {
      id: ticket.id,
      drawId: ticket.drawId,
      mainNumbers: ticket.mainNumbers,
      bonusNumber: ticket.bonusNumber,
      free: true,
    };
  }

  /** Devnet convenience: top the caller up with 10 demo USDT. */
  async usdtFaucet(userId: string) {
    if (!this.chain.lotteryEnabled) {
      throw new BadRequestException('On-chain lottery is not enabled');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const sig = await this.chain.usdtFaucet(user.walletAddress, BigInt(10_000_000)); // 10 USDT
    if (!sig) throw new BadRequestException('Faucet transfer failed');
    return { signature: sig, amountUsdtBase: '10000000' };
  }

  async buyTicket(
    params: { userId: string; mainNumbers: number[]; bonusNumber: number },
    key?: string,
  ) {
    // When the on-chain lottery is live, the play-money path is closed —
    // tickets must be real wallet-signed USDT purchases (POST /confirm).
    if (this.chain.lotteryEnabled) {
      throw new BadRequestException(
        'Tickets are bought on-chain with USDT — sign the purchase with your wallet',
      );
    }
    const { mainNumbers, bonusNumber } = params;

    // Validate the picks beyond what the DTO checks (distinctness).
    const distinct = new Set(mainNumbers);
    if (distinct.size !== LOTTERY.MAIN_COUNT) {
      throw new BadRequestException('Main numbers must be 5 distinct values');
    }

    const open = this.engine.getOpenDraw();
    if (!open) {
      throw new BadRequestException('No open draw — the next one starts shortly');
    }

    const price = BigInt(LOTTERY.TICKET_PRICE_LAMPORTS);

    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('Account banned');

    // Debit + create the ticket atomically. The conditional debit enforces
    // funds and closes the double-spend race.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const replay = await claimIdempotency(tx, params.userId, 'lottery_buy', key);
      if (replay) {
        return { response: replay as ReturnType<typeof this.serializeTicket>, replayed: true };
      }

      await applyBalanceDelta(tx, params.userId, -price, {
        reason: 'lottery_ticket',
        refType: 'LotteryDraw',
        refId: open.id,
      });
      const ticket = await tx.lotteryTicket.create({
        data: {
          drawId: open.id,
          userId: params.userId,
          mainNumbers: [...mainNumbers].sort((a, b) => a - b),
          bonusNumber,
          costLamports: price,
        },
      });

      const response = this.serializeTicket(ticket);
      await storeIdempotency(tx, params.userId, 'lottery_buy', key, response);
      return { response, replayed: false };
    });

    // Skip the pot/ticket-count engine update on replay — already counted.
    if (!outcome.replayed) await this.engine.onTicketSold(price);

    return outcome.response;
  }

  private serializeTicket(ticket: {
    id: string;
    drawId: string;
    mainNumbers: number[];
    bonusNumber: number;
    costLamports: bigint;
  }) {
    return {
      id: ticket.id,
      drawId: ticket.drawId,
      mainNumbers: ticket.mainNumbers,
      bonusNumber: ticket.bonusNumber,
      costLamports: ticket.costLamports.toString(),
    };
  }

  /**
   * bc.game-style "game number": the draw's wall-clock time (UTC+3, same zone
   * as the draw schedule) formatted as YYYYMMDDHHMMSS. Computed server-side —
   * the web bundle can't import runtime values from @scadium/shared.
   */
  private gameNumber(drawAt: Date): string {
    const local = new Date(drawAt.getTime() + LOTTERY.DRAW_TZ_OFFSET_MINUTES * 60_000);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return (
      `${local.getUTCFullYear()}${p(local.getUTCMonth() + 1)}${p(local.getUTCDate())}` +
      `${p(local.getUTCHours())}${p(local.getUTCMinutes())}${p(local.getUTCSeconds())}`
    );
  }

  async myTickets(userId: string, limit = 20, wonOnly = false) {
    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { userId, ...(wonOnly ? { won: true } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { draw: true },
    });
    return tickets.map((t) => ({
      id: t.id,
      drawId: t.drawId,
      gameNumber: this.gameNumber(t.draw.drawAt),
      mainNumbers: t.mainNumbers,
      bonusNumber: t.bonusNumber,
      costLamports: t.costLamports.toString(),
      matchedMain: t.matchedMain,
      matchedBonus: t.matchedBonus,
      payoutLamports: t.payoutLamports.toString(),
      payoutUsd: Number(t.payoutUsdtBase) / 10 ** LOTTERY.USDT_DECIMALS,
      tier: t.tier,
      free: t.free,
      txSignature: t.txSignature,
      prizeTxSignature: t.prizeTxSignature,
      won: t.won,
      drawStatus: t.draw.status,
      drawMain: t.draw.mainNumbers,
      drawBonus: t.draw.bonusNumber,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  /** Per-user lifetime lottery stats for the My Bets header cards. */
  async myStats(userId: string) {
    const [totalTickets, winningTickets, prizeSum] = await Promise.all([
      this.prisma.lotteryTicket.count({ where: { userId } }),
      this.prisma.lotteryTicket.count({ where: { userId, won: true } }),
      this.prisma.lotteryTicket.aggregate({
        where: { userId },
        _sum: { payoutUsdtBase: true },
      }),
    ]);
    return {
      totalTickets,
      winningTickets,
      totalPrizeUsd:
        Number(prizeSum._sum.payoutUsdtBase ?? BigInt(0)) / 10 ** LOTTERY.USDT_DECIMALS,
    };
  }

  /**
   * bc.game Results tab: one round's winning numbers, sale/winner tallies and
   * the public winners list (player display follows the leaderboard precedent:
   * username or truncated wallet). Public endpoint — the server seed is only
   * exposed once the draw has been revealed.
   */
  async drawResults(drawIndex: bigint, winnersLimit = 50) {
    const draw = await this.prisma.lotteryDraw.findUnique({
      where: { drawIndex },
      include: { seed: true },
    });
    if (!draw) throw new NotFoundException('Draw not found');

    const drawn = draw.status === 'drawn';
    const [winnersCount, winners] = await Promise.all([
      this.prisma.lotteryTicket.count({ where: { drawId: draw.id, won: true } }),
      this.prisma.lotteryTicket.findMany({
        where: { drawId: draw.id, won: true },
        orderBy: { payoutUsdtBase: 'desc' },
        take: winnersLimit,
        include: {
          user: { select: { username: true, walletAddress: true, avatarUrl: true } },
        },
      }),
    ]);

    return {
      drawId: draw.id,
      drawIndex: draw.drawIndex?.toString() ?? null,
      gameNumber: this.gameNumber(draw.drawAt),
      status: draw.status,
      drawAt: draw.drawAt.toISOString(),
      drawnAt: draw.drawnAt?.toISOString() ?? null,
      mainNumbers: draw.mainNumbers,
      bonusNumber: draw.bonusNumber,
      ticketCount: draw.ticketCount,
      potLamports: draw.potLamports.toString(),
      commitTxSignature: draw.commitTxSignature,
      revealTxSignature: draw.revealTxSignature,
      serverSeed: drawn ? draw.seed.serverSeed : null,
      serverSeedHash: draw.seed.serverSeedHash,
      clientSeed: draw.seed.clientSeed,
      nonce: draw.nonce,
      slotHash: draw.slotHash,
      winnersCount,
      winners: winners.map((t) => ({
        player: {
          username: t.user.username,
          walletAddress: t.user.walletAddress,
          avatarUrl: t.user.avatarUrl,
        },
        mainNumbers: t.mainNumbers,
        bonusNumber: t.bonusNumber,
        matchedMain: t.matchedMain,
        matchedBonus: t.matchedBonus,
        tier: t.tier,
        payoutUsd: Number(t.payoutUsdtBase) / 10 ** LOTTERY.USDT_DECIMALS,
      })),
    };
  }

  /** bc.game Jackpot Winners tab: historical grand-prize winners. */
  async jackpotWinners(limit = 50) {
    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { tier: 'grand' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { username: true, walletAddress: true, avatarUrl: true } },
        draw: true,
      },
    });
    return tickets.map((t) => ({
      drawIndex: t.draw.drawIndex?.toString() ?? null,
      gameNumber: this.gameNumber(t.draw.drawAt),
      drawnAt: t.draw.drawnAt?.toISOString() ?? null,
      player: {
        username: t.user.username,
        walletAddress: t.user.walletAddress,
        avatarUrl: t.user.avatarUrl,
      },
      mainNumbers: t.mainNumbers,
      bonusNumber: t.bonusNumber,
      matchedMain: t.matchedMain,
      matchedBonus: t.matchedBonus,
      payoutUsd: Number(t.payoutUsdtBase) / 10 ** LOTTERY.USDT_DECIMALS,
    }));
  }

  async recentDraws(limit = 10) {
    const draws = await this.prisma.lotteryDraw.findMany({
      where: { status: 'drawn' },
      orderBy: { drawnAt: 'desc' },
      take: limit,
      include: { seed: true },
    });
    return draws.map((d) => ({
      id: d.id,
      drawIndex: d.drawIndex?.toString() ?? null,
      gameNumber: this.gameNumber(d.drawAt),
      commitTxSignature: d.commitTxSignature,
      revealTxSignature: d.revealTxSignature,
      mainNumbers: d.mainNumbers,
      bonusNumber: d.bonusNumber,
      ticketCount: d.ticketCount,
      potLamports: d.potLamports.toString(),
      drawnAt: d.drawnAt?.toISOString() ?? null,
      serverSeed: d.seed.serverSeed,
      serverSeedHash: d.seed.serverSeedHash,
      clientSeed: d.seed.clientSeed,
      nonce: d.nonce,
      slotHash: d.slotHash,
    }));
  }
}
