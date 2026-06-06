import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  commitServerSeed,
  generateClientSeed,
  generateServerSeed,
  lotteryDraw,
  lotteryMatches,
  type LotteryResult,
} from '@scadium/fair';
import {
  LAMPORTS_PER_SOL,
  LOTTERY,
  SCAD,
  USD_PER_SOL,
  lotteryPrizeUsdtBase,
  lotteryTier,
  nextLotteryDrawAt,
} from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainService } from '../../solana/chain.service';
import { LotteryGateway } from './lottery.gateway';

const TIER_INDEX: Record<string, number> = { grand: 0, second: 1, third: 2, fourth: 3 };

interface CurrentDraw {
  id: string;
  drawIndex: bigint;
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
  commitTxSignature: string | null;
}

interface LastResult {
  drawId: string;
  drawIndex: string;
  mainNumbers: number[];
  bonusNumber: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  winnersCount: number;
  freeTickets: number;
  revealTxSignature: string | null;
  drawnAt: number;
}

/**
 * Singleton lottery scheduler — bc.game model, anchored on-chain.
 *
 * Every 8 hours (04:00/12:00/20:00 Istanbul): open a draw → publish the
 * sha256(serverSeed) commitment ON-CHAIN (commit_draw) → sell USER-signed
 * 0.1-USDT tickets → at draw time reveal the seed on-chain (the program
 * asserts the commitment) → fixed USD prizes paid in USDT from the lottery
 * treasury (pay_prize) → zero-match tickets re-enter the next draw free.
 */
@Injectable()
export class LotteryEngine implements OnModuleInit {
  private readonly logger = new Logger(LotteryEngine.name);
  private current!: CurrentDraw;
  private lastResult: LastResult | null = null;
  private drawTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LotteryGateway,
    private readonly chain: ChainService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.openNewDraw();
  }

  // ---------- Public API consumed by LotteryService ----------

  /** The currently open draw, or null if it has closed for drawing. */
  getOpenDraw(): { id: string; drawIndex: bigint; drawAt: number } | null {
    if (this.current.status !== 'open' || Date.now() >= this.current.drawAt) return null;
    return { id: this.current.id, drawIndex: this.current.drawIndex, drawAt: this.current.drawAt };
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
      drawIndex: this.current.drawIndex.toString(),
      status: this.current.status,
      serverSeedHash: this.current.serverSeedHash,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      drawAt: this.current.drawAt,
      ticketCount: this.current.ticketCount,
      potLamports: this.current.potLamports.toString(),
      ticketPriceUsd: LOTTERY.TICKET_PRICE_USD,
      ticketPriceUsdtBase: LOTTERY.TICKET_PRICE_USDT_BASE.toString(),
      commitTxSignature: this.current.commitTxSignature,
      chain: {
        enabled: this.chain.lotteryEnabled,
        programId: this.chain.lotteryProgramIdBase58,
        usdtMint: this.chain.usdtMintBase58,
      },
      config: {
        mainCount: LOTTERY.MAIN_COUNT,
        mainMax: LOTTERY.MAIN_MAX,
        bonusMax: LOTTERY.BONUS_MAX,
        prizesUsd: LOTTERY.PRIZES_USD,
        freeTicketOnZeroMatch: true,
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

    // Monotonic on-chain index: max existing + 1.
    const maxRow = await this.prisma.lotteryDraw.aggregate({ _max: { drawIndex: true } });
    const drawIndex = (maxRow._max.drawIndex ?? BigInt(0)) + BigInt(1);

    const drawAt = nextLotteryDrawAt(Date.now());
    const draw = await this.prisma.lotteryDraw.create({
      data: { drawIndex, seedId: seed.id, nonce, status: 'open', drawAt: new Date(drawAt) },
    });

    // Publish the commitment on-chain BEFORE sales. Await so the receipt is
    // available to buyers from the first second (no-op when disabled).
    let commitTxSignature: string | null = null;
    if (this.chain.lotteryEnabled) {
      commitTxSignature = await this.chain.lotteryCommitDraw({
        drawIndex,
        serverSeedHashHex: seed.serverSeedHash,
        clientSeedHex: clientSeed,
        drawAtMs: drawAt,
      });
      if (commitTxSignature) {
        await this.prisma.lotteryDraw.update({
          where: { id: draw.id },
          data: { commitTxSignature },
        });
      }
    }

    this.current = {
      id: draw.id,
      drawIndex,
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
      commitTxSignature,
    };

    // Carry over free tickets earned in the previous draw (zero-match rule).
    await this.seedFreeTickets(draw.id);

    this.gateway.emitDrawOpen({
      drawId: draw.id,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      drawAt,
    });

    this.drawTimer = setTimeout(
      () => {
        void this.drawAndSettle();
      },
      Math.max(0, drawAt - Date.now()),
    );
  }

  /** Dev/demo: resolve the current draw immediately (cancels the timer). */
  async forceDraw(): Promise<void> {
    if (this.current.status !== 'open') return;
    if (this.drawTimer) clearTimeout(this.drawTimer);
    await this.drawAndSettle();
  }

  /** bc.game rule: zero-match tickets re-enter the next draw on the house. */
  private async seedFreeTickets(newDrawId: string): Promise<void> {
    const pending = await this.prisma.lotteryTicket.findMany({
      where: { tier: 'free', free: false },
    });
    if (pending.length === 0) return;
    for (const t of pending) {
      await this.prisma.lotteryTicket.create({
        data: {
          drawId: newDrawId,
          userId: t.userId,
          mainNumbers: t.mainNumbers,
          bonusNumber: t.bonusNumber,
          costLamports: BigInt(0),
          free: true,
        },
      });
      // Mark the source ticket as converted so it can't spawn again.
      await this.prisma.lotteryTicket.update({ where: { id: t.id }, data: { free: true } });
      this.current.ticketCount += 1;
    }
    await this.prisma.lotteryDraw.update({
      where: { id: newDrawId },
      data: { ticketCount: this.current.ticketCount },
    });
    this.logger.log(`${pending.length} free ticket(s) carried into draw ${newDrawId}`);
  }

  private async drawAndSettle(): Promise<void> {
    this.current.status = 'drawn';
    const { main, bonus } = this.current.result;
    const drawIndex = this.current.drawIndex;

    // Reveal on-chain first — the program asserts sha256(seed) == commitment,
    // pinning the numbers before any payout moves.
    let revealTxSignature: string | null = null;
    if (this.chain.lotteryEnabled) {
      revealTxSignature = await this.chain.lotteryRevealDraw({
        drawIndex,
        serverSeedHex: this.current.serverSeed,
        main,
        bonus,
      });
    }

    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { drawId: this.current.id },
      include: { user: { select: { walletAddress: true } } },
    });

    let winnersCount = 0;
    let freeTickets = 0;
    const ops: Promise<unknown>[] = [];
    const prizeJobs: {
      ticketId: string;
      walletAddress: string;
      amountUsdtBase: bigint;
      tier: string;
    }[] = [];

    for (const t of tickets) {
      const { matchedMain, matchedBonus } = lotteryMatches(
        t.mainNumbers,
        t.bonusNumber,
        main,
        bonus,
      );
      const tier = lotteryTier(matchedMain, matchedBonus);
      const prizeUsdtBase = lotteryPrizeUsdtBase(tier);
      const won = prizeUsdtBase > BigInt(0);
      if (won) winnersCount += 1;
      if (tier === 'free') freeTickets += 1;

      // Ledger equivalents in lamports (real prizes move in USDT on-chain).
      const payoutLamportsEq =
        (prizeUsdtBase * BigInt(LAMPORTS_PER_SOL)) /
        BigInt(USD_PER_SOL) /
        BigInt(10 ** LOTTERY.USDT_DECIMALS);

      ops.push(
        this.prisma.user.update({
          where: { id: t.userId },
          data: {
            scadiumBalance: {
              increment: t.costLamports * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT),
            },
            totalWagered: { increment: t.costLamports },
            totalWon: { increment: won ? payoutLamportsEq : BigInt(0) },
            totalLost: { increment: won ? BigInt(0) : t.costLamports },
            gamesPlayed: { increment: 1 },
          },
        }),
      );

      ops.push(
        this.prisma.lotteryTicket.update({
          where: { id: t.id },
          data: {
            matchedMain,
            matchedBonus,
            tier,
            payoutUsdtBase: prizeUsdtBase,
            payoutLamports: payoutLamportsEq,
            won,
          },
        }),
      );

      ops.push(
        this.prisma.bet.create({
          data: {
            userId: t.userId,
            gameType: 'lottery',
            amountLamports: t.costLamports,
            payoutLamports: payoutLamportsEq,
            multiplier: null,
            status: won ? 'won' : 'lost',
            seedId: this.current.seedId,
            nonce: this.current.nonce,
            resultJson: {
              drawIndex: drawIndex.toString(),
              drawMain: main,
              drawBonus: bonus,
              ticketMain: t.mainNumbers,
              ticketBonus: t.bonusNumber,
              matchedMain,
              matchedBonus,
              tier,
              prizeUsd: Number(prizeUsdtBase) / 10 ** LOTTERY.USDT_DECIMALS,
            },
          },
        }),
      );

      if (won && this.chain.lotteryEnabled) {
        prizeJobs.push({
          ticketId: t.id,
          walletAddress: t.user.walletAddress,
          amountUsdtBase: prizeUsdtBase,
          tier,
        });
      }
    }

    ops.push(
      this.prisma.lotteryDraw.update({
        where: { id: this.current.id },
        data: {
          status: 'drawn',
          mainNumbers: main,
          bonusNumber: bonus,
          drawnAt: new Date(),
          revealTxSignature,
        },
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

    // On-chain USDT prize payouts AFTER the rows exist (fire-and-forget).
    for (const job of prizeJobs) {
      void this.chain
        .lotteryPayPrize({
          drawIndex,
          walletAddress: job.walletAddress,
          amountUsdtBase: job.amountUsdtBase,
          tier: TIER_INDEX[job.tier] ?? 255,
        })
        .then(async (sig) => {
          if (sig) {
            await this.prisma.lotteryTicket.update({
              where: { id: job.ticketId },
              data: { prizeTxSignature: sig },
            });
          }
        })
        .catch((e: unknown) =>
          this.logger.error(`pay_prize failed for ticket ${job.ticketId}: ${String(e)}`),
        );
    }

    this.lastResult = {
      drawId: this.current.id,
      drawIndex: drawIndex.toString(),
      mainNumbers: main,
      bonusNumber: bonus,
      serverSeed: this.current.serverSeed,
      serverSeedHash: this.current.serverSeedHash,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      winnersCount,
      freeTickets,
      revealTxSignature,
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
      `Lottery #${drawIndex} → [${main.join(',')}] +${bonus} · ${tickets.length} tickets · ${winnersCount} winners · ${freeTickets} free re-entries`,
    );

    // Open the next draw immediately (also materializes the free tickets).
    await this.openNewDraw();
  }
}
