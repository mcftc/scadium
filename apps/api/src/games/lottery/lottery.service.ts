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

  forceDraw() {
    return this.engine.forceDraw();
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

    const event = await this.chain.verifyTicketTx(params.signature);
    if (!event) throw new BadRequestException('Transaction not found or not a ticket purchase');
    if (event.buyer !== user.walletAddress) {
      throw new BadRequestException('Ticket was bought by a different wallet');
    }
    if (event.drawIndex !== open.drawIndex) {
      throw new BadRequestException('Ticket belongs to a different draw');
    }

    const existing = await this.prisma.lotteryTicket.count({
      where: { drawId: open.id, userId: params.userId },
    });
    if (existing >= LOTTERY.MAX_TICKETS_PER_DRAW) {
      throw new BadRequestException(`Max ${LOTTERY.MAX_TICKETS_PER_DRAW} tickets per draw`);
    }

    const price = BigInt(LOTTERY.TICKET_PRICE_LAMPORTS);
    // @unique on txSignature makes replaying the same signature impossible.
    const ticket = await this.prisma.lotteryTicket.create({
      data: {
        drawId: open.id,
        userId: params.userId,
        mainNumbers: [...event.main].sort((a, b) => a - b),
        bonusNumber: event.bonus,
        costLamports: price,
        txSignature: params.signature,
      },
    });
    await this.engine.onTicketSold(price);

    return {
      id: ticket.id,
      drawId: ticket.drawId,
      mainNumbers: ticket.mainNumbers,
      bonusNumber: ticket.bonusNumber,
      txSignature: params.signature,
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

  async buyTicket(params: { userId: string; mainNumbers: number[]; bonusNumber: number }) {
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
    if (user.playBalanceLamports < price) {
      throw new BadRequestException('Insufficient balance');
    }

    const existing = await this.prisma.lotteryTicket.count({
      where: { drawId: open.id, userId: params.userId },
    });
    if (existing >= LOTTERY.MAX_TICKETS_PER_DRAW) {
      throw new BadRequestException(`Max ${LOTTERY.MAX_TICKETS_PER_DRAW} tickets per draw`);
    }

    // Debit + create the ticket atomically.
    const ticket = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: params.userId },
        data: { playBalanceLamports: { decrement: price } },
      });
      return tx.lotteryTicket.create({
        data: {
          drawId: open.id,
          userId: params.userId,
          mainNumbers: [...mainNumbers].sort((a, b) => a - b),
          bonusNumber,
          costLamports: price,
        },
      });
    });

    await this.engine.onTicketSold(price);

    return {
      id: ticket.id,
      drawId: ticket.drawId,
      mainNumbers: ticket.mainNumbers,
      bonusNumber: ticket.bonusNumber,
      costLamports: ticket.costLamports.toString(),
    };
  }

  async myTickets(userId: string, limit = 20) {
    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { draw: true },
    });
    return tickets.map((t) => ({
      id: t.id,
      drawId: t.drawId,
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
    }));
  }
}
