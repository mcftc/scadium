import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  commitServerSeed,
  generateClientSeed,
  generateServerSeed,
  lotteryDraw,
  lotteryMatches,
  padClientSeed32,
  syntheticSlotHash,
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
  // NOTE: the result CANNOT be known here — it depends on a slot hash that
  // does not exist until draw time (that's the point of the new derivation).
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
  slotHash: string; // hex — third entropy input, needed by the verifier
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
 * treasury (pay_prize). Free tickets are a wager-loyalty reward (1/SOL).
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

  /** Register freshly-persisted tickets in the live tallies (`count` for bulk buys). */
  async onTicketSold(costLamports: bigint, count = 1): Promise<void> {
    this.current.ticketCount += count;
    this.current.potLamports += costLamports * BigInt(count);
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
        freeTicketPerSolWagered: true,
        // Bulk purchase tuning — served here because the web bundle can't
        // import runtime values from @scadium/shared (webpack interop).
        ticketPresets: LOTTERY.TICKET_COUNT_PRESETS,
        batchTicketsPerTx: LOTTERY.BATCH_TICKETS_PER_TX,
        maxBulkPerSubmit: LOTTERY.MAX_BATCH_TICKETS_PER_SUBMIT,
      },
      lastResult: this.lastResult,
    };
  }

  // ---------- Internal scheduler ----------

  private async openNewDraw(): Promise<void> {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 0;

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
      drawAt,
      status: 'open',
      ticketCount: 0,
      potLamports: BigInt(0),
      commitTxSignature,
    };

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


  private async drawAndSettle(): Promise<void> {
    this.current.status = 'drawn';
    const drawIndex = this.current.drawIndex;
    const { serverSeed, clientSeed, nonce } = this.current;

    // Reveal on-chain first — the program asserts sha256(seed) == commitment,
    // mixes in the newest slot hash, and derives the winning numbers ITSELF.
    // We adopt the chain's numbers. Off-chain (or if the reveal fails) we
    // fall back to a documented synthetic slot hash so the draw still settles.
    let revealTxSignature: string | null = null;
    let slotHashHex: string;
    let main: number[];
    let bonus: number;

    const reveal = this.chain.lotteryEnabled
      ? await this.chain.lotteryRevealDraw({ drawIndex, serverSeedHex: serverSeed })
      : null;
    if (reveal) {
      ({ main, bonus } = reveal);
      revealTxSignature = reveal.signature;
      slotHashHex = reveal.slotHashHex;
      // Lockstep cross-check: the TS derivation must reproduce the program's
      // numbers from the same inputs — divergence means a layout bug.
      const local = lotteryDraw(
        serverSeed,
        padClientSeed32(clientSeed),
        Buffer.from(slotHashHex, 'hex'),
        nonce,
      );
      if (local.main.join(',') !== main.join(',') || local.bonus !== bonus) {
        this.logger.error(
          `Draw #${drawIndex}: on-chain numbers [${main.join(',')}]+${bonus} diverge from local ` +
            `derivation [${local.main.join(',')}]+${local.bonus} — check the golden vector!`,
        );
      }
    } else {
      if (this.chain.lotteryEnabled) {
        this.logger.error(`Draw #${drawIndex}: on-chain reveal failed — settling synthetically`);
      }
      const synthetic = syntheticSlotHash(serverSeed, clientSeed);
      slotHashHex = synthetic.toString('hex');
      ({ main, bonus } = lotteryDraw(serverSeed, padClientSeed32(clientSeed), synthetic, nonce));
    }

    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { drawId: this.current.id },
      include: { user: { select: { walletAddress: true } } },
    });

    let winnersCount = 0;
    const freeTickets = 0; // zero-match rule removed — free tickets now come from wager loyalty
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
          slotHash: slotHashHex,
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
      slotHash: slotHashHex,
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
