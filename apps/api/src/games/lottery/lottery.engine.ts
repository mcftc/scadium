import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  commitServerSeed,
  generateClientSeed,
  generateServerSeed,
  lotteryDraw,
  lotteryLeadingMatch,
  lotteryBracket,
  padClientSeed32,
  syntheticSlotHash,
} from '@scadium/fair';
import {
  LOTTERY,
  SCAD,
  lotteryPoolSplit,
  ticketPriceScadBase,
  scadBaseToLamports,
  nextLotteryDrawAt,
} from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializable } from '../../prisma/with-serializable';
import { ChainService } from '../../solana/chain.service';
import { RedisService } from '../../redis/redis.service';
import { LeaderElection } from '../../redis/leader-election';
import { LotteryGateway } from './lottery.gateway';
import { splitBracketPrizes } from './lottery.settlement';

const SCAD_BASE_NUM = 10 ** LOTTERY.SCAD_DECIMALS;

// Single-writer election (#13/#86): only the lock holder opens/draws, so N
// replicas never produce duplicate LotteryDraw rows. No Redis → always leader.
const LOTTERY_LOCK_KEY = 'lock:engine:lottery';
const LOTTERY_LOCK_TTL_MS = 10_000;

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
  // $SCAD economy for this round (base units):
  ticketPriceScadBase: bigint;
  injectionScadBase: bigint;
  rolloverScadBase: bigint; // carried in from the prior round's unwon slices
  salesScadBase: bigint; // running discounted sales (display only; recomputed at settle)
  potLamports: bigint; // SOL-equiv ledger mirror
  commitTxSignature: string | null;
}

interface LastResult {
  drawId: string;
  drawIndex: string;
  digits: number[];
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  slotHash: string; // hex — third entropy input, needed by the verifier
  winnersCount: number;
  bracketWinnerCounts: number[];
  totalPoolScad: number;
  burnScad: number;
  topPrizeScad: number; // biggest single-ticket payout of the round (header banner)
  revealTxSignature: string | null;
  drawnAt: number;
}

/**
 * Singleton lottery scheduler — PancakeSwap-v2 model, anchored on-chain.
 *
 * Once a day at 12:00 (Istanbul): open a draw → publish the sha256(serverSeed)
 * commitment ON-CHAIN (commit_draw) + inject house $SCAD → sell USER-signed
 * $SCAD tickets (6 digits) with a bulk discount → at draw time reveal the seed
 * on-chain (the program derives the 6-digit number) → split the pool per
 * bracket (equal share among each bracket's winners, 20% burned, unwon slices
 * rolled forward) and pay winners in $SCAD (pay_prize). Free tickets are a
 * wager-loyalty reward (1/SOL).
 */
@Injectable()
export class LotteryEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LotteryEngine.name);
  private current!: CurrentDraw;
  private lastResult: LastResult | null = null;
  private drawTimer: NodeJS.Timeout | null = null;
  private election: LeaderElection | null = null;
  /** Unwon bracket slices carried into the NEXT round's pool (PancakeSwap auto-injection). */
  private carryRolloverScadBase = BigInt(0);
  /** True while replaying stranded draws on boot — suppresses the chained
   * openNewDraw() in drawAndSettle so onModuleInit opens exactly one fresh draw
   * after all stranded draws settle. */
  private recovering = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LotteryGateway,
    private readonly chain: ChainService,
    private readonly redis?: RedisService,
  ) {
    if (this.redis) {
      this.election = new LeaderElection(this.redis.client, LOTTERY_LOCK_KEY, LOTTERY_LOCK_TTL_MS);
    }
  }

  /** Only the elected leader opens/draws. No Redis = always leader. */
  isLeader(): boolean {
    return this.election ? this.election.isLeader() : true;
  }

  async onModuleInit(): Promise<void> {
    if (!this.election) {
      await this.recoverStrandedDraws();
      await this.openNewDraw();
      return;
    }
    // Multi-instance: placeholder keeps reads safe until we lead; only the leader
    // opens draws. (Cross-pod live state is wired in #87.)
    this.current = this.placeholderDraw();
    // Acquire synchronously so a single instance has an open draw before init
    // resolves; start() then fires only on later leadership transitions.
    await this.election.tick();
    if (this.isLeader()) await this.assumeLeadership();
    this.election.start((leader) => {
      if (leader) void this.assumeLeadership();
      else this.logger.warn('lottery: lost leadership — standing by');
    });
  }

  private placeholderDraw(): CurrentDraw {
    return {
      id: '',
      drawIndex: BigInt(0),
      seedId: '',
      serverSeed: '',
      serverSeedHash: '',
      clientSeed: '',
      nonce: 0,
      drawAt: 0,
      status: 'open',
      ticketCount: 0,
      ticketPriceScadBase: BigInt(0),
      injectionScadBase: BigInt(0),
      rolloverScadBase: BigInt(0),
      salesScadBase: BigInt(0),
      potLamports: BigInt(0),
      commitTxSignature: null,
    };
  }

  private async assumeLeadership(): Promise<void> {
    this.logger.log('lottery: elected leader — driving draws');
    await this.recoverStrandedDraws();
    await this.openNewDraw();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.drawTimer) clearTimeout(this.drawTimer);
    if (this.election) await this.election.stop();
  }

  /**
   * Boot recovery: a restart strands every draw left 'open'. For each,
   * reconstruct `this.current` from the DB draw + its Seed and call the
   * transactional `drawAndSettle()` (it recomputes sales from the tickets and
   * has a synthetic-slot-hash fallback, so it always settles). The chained
   * openNewDraw() is suppressed via `recovering`.
   */
  private async recoverStrandedDraws(): Promise<void> {
    let stranded: {
      id: string;
      drawIndex: bigint | null;
      seedId: string;
      injectionScadBase: bigint;
      rolloverScadBase: bigint;
      ticketPriceScadBase: bigint;
    }[];
    try {
      stranded = await this.prisma.lotteryDraw.findMany({
        where: { status: 'open' },
        select: {
          id: true,
          drawIndex: true,
          seedId: true,
          injectionScadBase: true,
          rolloverScadBase: true,
          ticketPriceScadBase: true,
        },
        orderBy: { createdAt: 'asc' },
      });
    } catch (e) {
      this.logger.error(
        `lottery recovery scan failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (stranded.length === 0) return;
    this.logger.warn(`lottery recovery: ${stranded.length} stranded draw(s) — settling`);

    this.recovering = true;
    try {
      for (const d of stranded) {
        try {
          const seed = await this.prisma.seed.findUniqueOrThrow({ where: { id: d.seedId } });
          this.current = {
            id: d.id,
            drawIndex: d.drawIndex ?? BigInt(0),
            seedId: seed.id,
            serverSeed: seed.serverSeed ?? '',
            serverSeedHash: seed.serverSeedHash,
            clientSeed: seed.clientSeed,
            nonce: seed.nonce,
            drawAt: Date.now(),
            status: 'open',
            ticketCount: 0,
            ticketPriceScadBase: d.ticketPriceScadBase,
            injectionScadBase: d.injectionScadBase,
            rolloverScadBase: d.rolloverScadBase,
            salesScadBase: BigInt(0),
            potLamports: BigInt(0),
            commitTxSignature: null,
          };
          await this.drawAndSettle();
          this.logger.log(`lottery recovery: draw ${d.id} settled`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          this.logger.error(`lottery recovery failed for draw ${d.id}: ${message}`);
          try {
            await this.prisma.settlementFailure.create({
              data: {
                gameType: 'lottery',
                roundId: d.id,
                payloadJson: { drawId: d.id, path: 'recovery' },
                error: message,
              },
            });
          } catch (deadLetterErr) {
            this.logger.error(
              `lottery recovery: failed to write SettlementFailure for ${d.id}: ${String(deadLetterErr)}`,
            );
          }
        }
      }
    } finally {
      this.recovering = false;
    }
  }

  // ---------- Public API consumed by LotteryService ----------

  /** The currently open draw, or null if it has closed for drawing. */
  getOpenDraw(): { id: string; drawIndex: bigint; drawAt: number } | null {
    if (this.current.status !== 'open' || Date.now() >= this.current.drawAt) return null;
    return { id: this.current.id, drawIndex: this.current.drawIndex, drawAt: this.current.drawAt };
  }

  /** This round's per-ticket price in $SCAD base units. */
  ticketPriceScadBase(): bigint {
    return this.current.ticketPriceScadBase;
  }

  private currentPoolScadBase(): bigint {
    return this.current.salesScadBase + this.current.injectionScadBase + this.current.rolloverScadBase;
  }

  /** Register freshly-persisted tickets in the live tallies (`count` for bulk buys). */
  async onTicketSold(scadBase: bigint, lamports: bigint, count = 1): Promise<void> {
    this.current.ticketCount += count;
    this.current.salesScadBase += scadBase;
    this.current.potLamports += lamports;
    await this.prisma.lotteryDraw.update({
      where: { id: this.current.id },
      data: { ticketCount: this.current.ticketCount, potLamports: this.current.potLamports },
    });
    this.gateway.emitTicketSold({
      drawId: this.current.id,
      ticketCount: this.current.ticketCount,
      potLamports: this.current.potLamports.toString(),
      totalPoolScadBase: this.currentPoolScadBase().toString(),
    });
  }

  snapshot() {
    const pool = this.currentPoolScadBase();
    const jackpotSlice = lotteryPoolSplit(pool).brackets[LOTTERY.BRACKET_COUNT - 1] ?? BigInt(0);
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
      ticketPriceScadBase: this.current.ticketPriceScadBase.toString(),
      ticketPriceScad: Number(this.current.ticketPriceScadBase) / SCAD_BASE_NUM,
      ticketPriceUsd: LOTTERY.TICKET_PRICE_USD,
      injectionScadBase: this.current.injectionScadBase.toString(),
      rolloverScadBase: this.current.rolloverScadBase.toString(),
      totalPoolScadBase: pool.toString(),
      totalPoolScad: Number(pool) / SCAD_BASE_NUM,
      // Header "Latest Winning Prize": biggest payout of the last settled round,
      // else the current jackpot-bracket slice estimate.
      latestWinningPrizeScad:
        this.lastResult && this.lastResult.topPrizeScad > 0
          ? this.lastResult.topPrizeScad
          : Number(jackpotSlice) / SCAD_BASE_NUM,
      commitTxSignature: this.current.commitTxSignature,
      chain: {
        enabled: this.chain.lotteryEnabled,
        programId: this.chain.lotteryProgramIdBase58,
        scadMint: this.chain.scadMintBase58,
      },
      config: {
        digits: LOTTERY.DIGITS,
        digitMax: LOTTERY.DIGIT_MAX - 1, // top digit value (9)
        bracketCount: LOTTERY.BRACKET_COUNT,
        rewardsBreakdownBps: LOTTERY.REWARDS_BREAKDOWN_BPS,
        burnBps: LOTTERY.TREASURY_FEE_BPS,
        discountDivisor: LOTTERY.DISCOUNT_DIVISOR,
        maxTicketsPerPurchase: LOTTERY.MAX_TICKETS_PER_PURCHASE,
        freeTicketPerSolWagered: true,
        // Bulk purchase tuning — served here because the web bundle can't
        // import runtime values from @scadium/shared (webpack interop).
        ticketPresets: LOTTERY.TICKET_COUNT_PRESETS,
        batchTicketsPerTx: LOTTERY.BATCH_TICKETS_PER_TX,
        maxManualRows: LOTTERY.MAX_MANUAL_ROWS,
      },
      lastResult: this.lastResult,
    };
  }

  // ---------- Internal scheduler ----------

  private async openNewDraw(): Promise<void> {
    if (!this.isLeader()) return; // never open a draw as a non-leader
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 0;

    const seed = await this.prisma.seed.create({
      data: { serverSeed, serverSeedHash: commitServerSeed(serverSeed), clientSeed, nonce },
    });

    // Monotonic on-chain index: max existing + 1.
    const maxRow = await this.prisma.lotteryDraw.aggregate({ _max: { drawIndex: true } });
    const drawIndex = (maxRow._max.drawIndex ?? BigInt(0)) + BigInt(1);

    const price = ticketPriceScadBase();
    const injection = BigInt(LOTTERY.INJECTION_SCAD_BASE);
    const rollover = this.carryRolloverScadBase;
    this.carryRolloverScadBase = BigInt(0);

    const drawAt = nextLotteryDrawAt(Date.now());
    const draw = await this.prisma.lotteryDraw.create({
      data: {
        drawIndex,
        seedId: seed.id,
        nonce,
        status: 'open',
        drawAt: new Date(drawAt),
        ticketPriceScadBase: price,
        injectionScadBase: injection,
        rolloverScadBase: rollover,
      },
    });

    // Publish the commitment on-chain BEFORE sales, then inject house $SCAD.
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
      if (injection > BigInt(0)) {
        void this.chain
          .lotteryInject({ drawIndex, amountScadBase: injection })
          .catch((e: unknown) => this.logger.error(`inject #${drawIndex} failed: ${String(e)}`));
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
      ticketPriceScadBase: price,
      injectionScadBase: injection,
      rolloverScadBase: rollover,
      salesScadBase: BigInt(0),
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
    if (!this.isLeader()) return; // only the leader settles
    const drawIndex = this.current.drawIndex;
    const { serverSeed, clientSeed, nonce } = this.current;

    // Reveal on-chain first — the program asserts sha256(seed) == commitment,
    // mixes in the newest slot hash, and derives the winning digits ITSELF.
    // We adopt the chain's digits. Off-chain (or if the reveal fails) we fall
    // back to a documented synthetic slot hash so the draw still settles.
    let revealTxSignature: string | null = null;
    let slotHashHex: string;
    let digits: number[];

    const reveal = this.chain.lotteryEnabled
      ? await this.chain.lotteryRevealDraw({ drawIndex, serverSeedHex: serverSeed })
      : null;
    if (reveal) {
      digits = reveal.digits;
      revealTxSignature = reveal.signature;
      slotHashHex = reveal.slotHashHex;
      // Lockstep cross-check: the TS derivation must reproduce the program's
      // digits from the same inputs — divergence means a layout bug.
      const local = lotteryDraw(
        serverSeed,
        padClientSeed32(clientSeed),
        Buffer.from(slotHashHex, 'hex'),
        nonce,
      );
      if (local.digits.join(',') !== digits.join(',')) {
        this.logger.error(
          `Draw #${drawIndex}: on-chain digits [${digits.join(',')}] diverge from local ` +
            `derivation [${local.digits.join(',')}] — check the golden vector!`,
        );
      }
    } else {
      if (this.chain.lotteryEnabled) {
        this.logger.error(`Draw #${drawIndex}: on-chain reveal failed — settling synthetically`);
      }
      const synthetic = syntheticSlotHash(serverSeed, clientSeed);
      slotHashHex = synthetic.toString('hex');
      digits = lotteryDraw(serverSeed, padClientSeed32(clientSeed), synthetic, nonce).digits;
    }

    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { drawId: this.current.id },
      include: { user: { select: { walletAddress: true } } },
    });

    // ----- Phase 1 (pure): bracket every ticket + size the pool -----
    const B = LOTTERY.BRACKET_COUNT;
    const bracketWinnerCounts = new Array<number>(B).fill(0);
    const matched = tickets.map((t) => {
      const matchLen = lotteryLeadingMatch(t.digits, digits);
      const bracket = lotteryBracket(matchLen);
      if (bracket !== null) bracketWinnerCounts[bracket] += 1;
      return { ticket: t, matchLen, bracket };
    });

    // Sales are recomputed from the tickets (robust across restarts).
    const salesScadBase = tickets.reduce((acc, t) => acc + t.costScadBase, BigInt(0));
    const totalPool = salesScadBase + this.current.injectionScadBase + this.current.rolloverScadBase;
    const {
      bracketSlices,
      perWinner,
      bracketRollover,
      burn: burnScadBase,
      nextRollover,
    } = splitBracketPrizes(totalPool, bracketWinnerCounts);

    let winnersCount = 0;
    let topPrizeScadBase = BigInt(0);
    const prizeJobs: { ticketId: string; walletAddress: string; amountScadBase: bigint; bracket: number }[] =
      [];

    const ticketResults = matched.map((m) => {
      const payoutScadBase = m.bracket !== null ? perWinner[m.bracket]! : BigInt(0);
      const won = payoutScadBase > BigInt(0);
      if (won) winnersCount += 1;
      if (payoutScadBase > topPrizeScadBase) topPrizeScadBase = payoutScadBase;
      const payoutLamports = scadBaseToLamports(payoutScadBase);
      if (won && this.chain.lotteryEnabled) {
        prizeJobs.push({
          ticketId: m.ticket.id,
          walletAddress: m.ticket.user.walletAddress,
          amountScadBase: payoutScadBase,
          bracket: m.bracket!,
        });
      }
      return { ...m, payoutScadBase, payoutLamports, won };
    });

    // ----- Phase 2: ledger + ticket updates + draw flip + reveal, atomically -----
    try {
      await withSerializable(this.prisma, async (tx) => {
        for (const r of ticketResults) {
          const t = r.ticket;
          await tx.user.update({
            where: { id: t.userId },
            data: {
              // Loyalty $SCAD reward kept (per product decision): wagering the
              // lottery still accrues the standard wager reward.
              scadiumBalance: {
                increment: t.costLamports * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT),
              },
              totalWagered: { increment: t.costLamports },
              totalWon: { increment: r.won ? r.payoutLamports : BigInt(0) },
              totalLost: { increment: r.won ? BigInt(0) : t.costLamports },
              gamesPlayed: { increment: 1 },
            },
          });
          await tx.lotteryTicket.update({
            where: { id: t.id },
            data: {
              matchLen: r.matchLen,
              bracket: r.bracket,
              payoutScadBase: r.payoutScadBase,
              payoutLamports: r.payoutLamports,
              won: r.won,
            },
          });
          await tx.bet.create({
            data: {
              userId: t.userId,
              gameType: 'lottery',
              amountLamports: t.costLamports,
              payoutLamports: r.payoutLamports,
              multiplier: null,
              status: r.won ? 'won' : 'lost',
              seedId: this.current.seedId,
              nonce: this.current.nonce,
              resultJson: {
                drawIndex: drawIndex.toString(),
                drawDigits: digits,
                ticketDigits: t.digits,
                matchLen: r.matchLen,
                bracket: r.bracket,
                prizeScad: Number(r.payoutScadBase) / SCAD_BASE_NUM,
              },
            },
          });
        }

        await tx.lotteryDraw.update({
          where: { id: this.current.id },
          data: {
            status: 'drawn',
            winningDigits: digits,
            slotHash: slotHashHex,
            drawnAt: new Date(),
            revealTxSignature,
            totalPoolScadBase: totalPool,
            burnScadBase,
            bracketWinnerCounts,
            bracketAmountsScadBase: bracketSlices,
            bracketRolloverScadBase: bracketRollover,
          },
        });
        await tx.seed.update({
          where: { id: this.current.seedId },
          data: { revealedAt: new Date() },
        });
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Lottery settle failed for ${this.current.id} after retries: ${message}`);
      try {
        await this.prisma.settlementFailure.create({
          data: {
            gameType: 'lottery',
            roundId: this.current.id,
            payloadJson: {
              drawId: this.current.id,
              drawIndex: drawIndex.toString(),
              digits,
              slotHash: slotHashHex,
              totalPoolScadBase: totalPool.toString(),
              tickets: ticketResults.map((r) => ({
                ticketId: r.ticket.id,
                userId: r.ticket.userId,
                bracket: r.bracket,
                payoutScadBase: r.payoutScadBase.toString(),
                won: r.won,
              })),
            },
            error: message,
          },
        });
      } catch (deadLetterErr) {
        this.logger.error(
          `Failed to write SettlementFailure for lottery ${this.current.id}: ${String(deadLetterErr)}`,
        );
      }
      return;
    }

    this.current.status = 'drawn';
    // Unwon slices fund the next round's pool (PancakeSwap auto-injection).
    this.carryRolloverScadBase = nextRollover;

    // On-chain $SCAD prize payouts + burn AFTER the rows commit (fire-and-forget).
    for (const job of prizeJobs) {
      void this.chain
        .lotteryPayPrize({
          drawIndex,
          walletAddress: job.walletAddress,
          amountScadBase: job.amountScadBase,
          bracket: job.bracket,
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
    if (this.chain.lotteryEnabled && burnScadBase > BigInt(0)) {
      void this.chain
        .lotteryBurnPool({ drawIndex, amountScadBase: burnScadBase })
        .catch((e: unknown) => this.logger.error(`burn_pool #${drawIndex} failed: ${String(e)}`));
    }

    this.lastResult = {
      drawId: this.current.id,
      drawIndex: drawIndex.toString(),
      digits,
      serverSeed: this.current.serverSeed,
      serverSeedHash: this.current.serverSeedHash,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      slotHash: slotHashHex,
      winnersCount,
      bracketWinnerCounts,
      totalPoolScad: Number(totalPool) / SCAD_BASE_NUM,
      burnScad: Number(burnScadBase) / SCAD_BASE_NUM,
      topPrizeScad: Number(topPrizeScadBase) / SCAD_BASE_NUM,
      revealTxSignature,
      drawnAt: Date.now(),
    };

    this.gateway.emitDrawResult({
      drawId: this.current.id,
      digits,
      serverSeed: this.current.serverSeed,
      winnersCount,
      bracketWinnerCounts,
      burnScadBase: burnScadBase.toString(),
    });

    this.logger.log(
      `Lottery #${drawIndex} → [${digits.join('')}] · ${tickets.length} tickets · ${winnersCount} winners · ` +
        `pool ${Number(totalPool) / SCAD_BASE_NUM} SCAD · burn ${Number(burnScadBase) / SCAD_BASE_NUM} · ` +
        `rollover ${Number(nextRollover) / SCAD_BASE_NUM}`,
    );

    if (!this.recovering) await this.openNewDraw();
  }
}
