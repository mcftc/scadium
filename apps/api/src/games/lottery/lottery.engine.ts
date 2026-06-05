import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  commitServerSeed,
  generateClientSeed,
  generateServerSeed,
  lotteryDraw,
  lotteryMatches,
  type LotteryResult,
} from '@scadium/fair';
import { LOTTERY, lotteryPrizeMultiplier, nextLotteryDrawAt } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LotteryGateway } from './lottery.gateway';

interface CurrentDraw {
  id: string;
  seedId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  result: LotteryResult; // committed up-front, revealed at draw time
  drawAt: number; // epoch ms when this draw resolves
  status: 'open' | 'drawn';
  ticketCount: number;
  potLamports: bigint;
}

interface LastResult {
  drawId: string;
  mainNumbers: number[];
  bonusNumber: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  winnersCount: number;
  drawnAt: number;
}

/**
 * Singleton lottery scheduler. Like the crash engine it owns the only live
 * draw in memory: open a draw → sell tickets until the next fixed draw time
 * (04:00 / 16:00 local, i.e. every 12h) → derive the provably-fair result →
 * settle every ticket from the DB → open the next draw.
 *
 * The winning numbers are committed (sha256(serverSeed) published) the moment
 * the draw opens and only revealed after it resolves, so no one — not even the
 * house — can know the outcome while tickets are being sold.
 */
@Injectable()
export class LotteryEngine implements OnModuleInit {
  private readonly logger = new Logger(LotteryEngine.name);
  private current!: CurrentDraw;
  private lastResult: LastResult | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LotteryGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.openNewDraw();
  }

  // ---------- Public API consumed by LotteryService ----------

  /** The currently open draw, or null if it has closed for drawing. */
  getOpenDraw(): { id: string; drawAt: number } | null {
    if (this.current.status !== 'open' || Date.now() >= this.current.drawAt) return null;
    return { id: this.current.id, drawAt: this.current.drawAt };
  }

  /** Register a freshly-persisted ticket in the live tallies. */
  async onTicketSold(costLamports: bigint): Promise<void> {
    this.current.ticketCount += 1;
    this.current.potLamports += costLamports;
    await this.prisma.lotteryDraw.update({
      where: { id: this.current.id },
      data: { ticketCount: this.current.ticketCount, potLamports: this.current.potLamports },
    });
    this.gateway.emitTicketSold({
      drawId: this.current.id,
      ticketCount: this.current.ticketCount,
      potLamports: this.current.potLamports.toString(),
    });
  }

  snapshot() {
    return {
      drawId: this.current.id,
      status: this.current.status,
      serverSeedHash: this.current.serverSeedHash,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      drawAt: this.current.drawAt,
      ticketCount: this.current.ticketCount,
      potLamports: this.current.potLamports.toString(),
      ticketPriceLamports: LOTTERY.TICKET_PRICE_LAMPORTS.toString(),
      ticketPriceUsd: LOTTERY.TICKET_PRICE_USD,
      config: {
        mainCount: LOTTERY.MAIN_COUNT,
        mainMax: LOTTERY.MAIN_MAX,
        bonusMax: LOTTERY.BONUS_MAX,
        prizes: LOTTERY.PRIZES,
      },
      lastResult: this.lastResult,
    };
  }

  // ---------- Internal scheduler ----------

  private async openNewDraw(): Promise<void> {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 0;
    const result = lotteryDraw(serverSeed, clientSeed, nonce);

    const seed = await this.prisma.seed.create({
      data: { serverSeed, serverSeedHash: commitServerSeed(serverSeed), clientSeed, nonce },
    });

    const drawAt = nextLotteryDrawAt(Date.now());
    const draw = await this.prisma.lotteryDraw.create({
      data: { seedId: seed.id, nonce, status: 'open', drawAt: new Date(drawAt) },
    });

    this.current = {
      id: draw.id,
      seedId: seed.id,
      serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      result,
      drawAt,
      status: 'open',
      ticketCount: 0,
      potLamports: BigInt(0),
    };

    this.gateway.emitDrawOpen({
      drawId: draw.id,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      drawAt,
    });

    setTimeout(
      () => {
        void this.drawAndSettle();
      },
      Math.max(0, drawAt - Date.now()),
    );
  }

  private async drawAndSettle(): Promise<void> {
    this.current.status = 'drawn';
    const { main, bonus } = this.current.result;

    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { drawId: this.current.id },
    });

    let winnersCount = 0;
    const ops: Promise<unknown>[] = [];

    for (const t of tickets) {
      const { matchedMain, matchedBonus } = lotteryMatches(
        t.mainNumbers,
        t.bonusNumber,
        main,
        bonus,
      );
      const mult = lotteryPrizeMultiplier(matchedMain, matchedBonus);
      const payout = BigInt(mult) * t.costLamports;
      const won = payout > BigInt(0);
      if (mult > 0) winnersCount += 1;

      const profit = payout - t.costLamports;

      ops.push(
        this.prisma.user.update({
          where: { id: t.userId },
          data: {
            playBalanceLamports: { increment: payout },
            totalWagered: { increment: t.costLamports },
            totalWon: { increment: profit > BigInt(0) ? profit : BigInt(0) },
            totalLost: { increment: profit < BigInt(0) ? -profit : BigInt(0) },
            gamesPlayed: { increment: 1 },
          },
        }),
      );

      ops.push(
        this.prisma.lotteryTicket.update({
          where: { id: t.id },
          data: { matchedMain, matchedBonus, payoutLamports: payout, won },
        }),
      );

      ops.push(
        this.prisma.bet.create({
          data: {
            userId: t.userId,
            gameType: 'lottery',
            amountLamports: t.costLamports,
            payoutLamports: payout,
            multiplier: mult,
            status: won ? 'won' : 'lost',
            seedId: this.current.seedId,
            nonce: this.current.nonce,
            resultJson: {
              drawMain: main,
              drawBonus: bonus,
              ticketMain: t.mainNumbers,
              ticketBonus: t.bonusNumber,
              matchedMain,
              matchedBonus,
            },
          },
        }),
      );
    }

    ops.push(
      this.prisma.lotteryDraw.update({
        where: { id: this.current.id },
        data: { status: 'drawn', mainNumbers: main, bonusNumber: bonus, drawnAt: new Date() },
      }),
    );
    ops.push(
      this.prisma.seed.update({
        where: { id: this.current.seedId },
        data: { revealedAt: new Date() },
      }),
    );

    try {
      await Promise.all(ops);
    } catch (e) {
      this.logger.error(`Lottery settle failed: ${e instanceof Error ? e.message : e}`);
    }

    this.lastResult = {
      drawId: this.current.id,
      mainNumbers: main,
      bonusNumber: bonus,
      serverSeed: this.current.serverSeed,
      serverSeedHash: this.current.serverSeedHash,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      winnersCount,
      drawnAt: Date.now(),
    };

    this.gateway.emitDrawResult({
      drawId: this.current.id,
      mainNumbers: main,
      bonusNumber: bonus,
      serverSeed: this.current.serverSeed,
      winnersCount,
    });

    this.logger.log(
      `Lottery draw ${this.current.id} → [${main.join(',')}] +${bonus} · ${tickets.length} tickets · ${winnersCount} winners`,
    );

    // Open the next draw immediately.
    await this.openNewDraw();
  }
}
