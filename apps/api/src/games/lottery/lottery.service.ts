import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LOTTERY } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
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
  ) {}

  snapshot() {
    return this.engine.snapshot();
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
