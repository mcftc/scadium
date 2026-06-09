import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { crashPoint, generateServerSeed, generateClientSeed, commitServerSeed } from '@scadium/fair';
import { CRASH, SCAD } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializable } from '../../prisma/with-serializable';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { ChainService } from '../../solana/chain.service';
import { CrashGateway } from './crash.gateway';

type Phase = 'waiting' | 'running' | 'busted';

interface LiveBet {
  userId: string;
  username: string | null;
  walletAddress: string;
  /** REMAINING stake still riding (shrinks on partial cashouts). */
  amountLamports: bigint;
  /** Original stake — the wager for ledger/aggregates. */
  originalAmountLamports: bigint;
  /** Payout accumulated across (partial) cashouts this round. */
  payoutLamports: bigint;
  autoCashout: number | null;
  cashedOutAt: number | null; // multiplier of the FINAL (full) exit
}

interface Round {
  id: string;
  seedId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  bustPoint: number;
  phase: Phase;
  startedAt: number | null; // ms epoch when "running" began
  bets: Map<string, LiveBet>;
}

/** Bet queued for the NEXT round ("Schedule Bet For Next Round"). */
interface ScheduledBet {
  userId: string;
  username: string | null;
  walletAddress: string;
  amountLamports: bigint;
  autoCashout: number | null;
}

/**
 * Background round engine. Drives the crash game independently of any
 * HTTP request: betting window → running tick loop → bust → settle →
 * new round. Broadcasts state via the CrashGateway.
 *
 * The bust point is derived from a committed HMAC-SHA256 seed pair so
 * every round is provably fair — players can verify after reveal.
 */
@Injectable()
export class CrashEngine implements OnModuleInit {
  private readonly logger = new Logger(CrashEngine.name);
  private current!: Round;
  private history: { bustPoint: number; roundId: string }[] = [];
  /** One queued bet per user, auto-placed when the next round opens. */
  private readonly nextRoundBets = new Map<string, ScheduledBet>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CrashGateway,
    private readonly chain: ChainService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startNewRound();
  }

  // ---------- Public API consumed by CrashService ----------

  snapshot() {
    return {
      roundId: this.current.id,
      phase: this.current.phase,
      startedAt: this.current.startedAt,
      serverSeedHash: this.current.serverSeedHash,
      // Public, non-secret round inputs — let players reproduce the result.
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      // serverSeed is only revealed once the round has busted (the commitment
      // is sha256(serverSeed), published up-front via serverSeedHash).
      serverSeed: this.current.phase === 'busted' ? this.current.serverSeed : null,
      bustPoint: this.current.phase === 'busted' ? this.current.bustPoint : null,
      multiplier: this.currentMultiplier(),
      bets: Array.from(this.current.bets.values()).map((b) => ({
        userId: b.userId,
        username: b.username,
        walletAddress: b.walletAddress,
        amountLamports: b.amountLamports.toString(),
        originalAmountLamports: b.originalAmountLamports.toString(),
        payoutLamports: b.payoutLamports.toString(),
        autoCashout: b.autoCashout,
        cashedOutAt: b.cashedOutAt,
      })),
      history: this.history.slice(-20),
    };
  }

  placeBet(params: {
    userId: string;
    username: string | null;
    walletAddress: string;
    amountLamports: bigint;
    autoCashout: number | null;
  }): { ok: true; roundId: string } {
    if (this.current.phase !== 'waiting') {
      throw new Error('Betting window closed');
    }
    if (this.current.bets.has(params.userId)) {
      throw new Error('You already have a bet in this round');
    }
    this.current.bets.set(params.userId, {
      userId: params.userId,
      username: params.username,
      walletAddress: params.walletAddress,
      amountLamports: params.amountLamports,
      originalAmountLamports: params.amountLamports,
      payoutLamports: BigInt(0),
      autoCashout: params.autoCashout,
      cashedOutAt: null,
    });
    this.gateway.emitBetPlaced(this.current.id, params);
    return { ok: true, roundId: this.current.id };
  }

  /**
   * Queue a bet for the NEXT round. Allowed in any phase — players schedule
   * mid-flight when they missed the window, or stack a follow-up while their
   * current bet rides. The caller (service) has already debited the balance,
   * so draining the queue at round start cannot fail.
   */
  scheduleBet(params: {
    userId: string;
    username: string | null;
    walletAddress: string;
    amountLamports: bigint;
    autoCashout: number | null;
  }): { ok: true } {
    if (this.nextRoundBets.has(params.userId)) {
      throw new Error('You already have a bet scheduled for the next round');
    }
    this.nextRoundBets.set(params.userId, { ...params });
    return { ok: true };
  }

  /** Remove the caller's queued bet; returns its stake for the refund. */
  cancelScheduled(userId: string): { amountLamports: bigint } {
    const queued = this.nextRoundBets.get(userId);
    if (!queued) throw new Error('No scheduled bet to cancel');
    this.nextRoundBets.delete(userId);
    return { amountLamports: queued.amountLamports };
  }

  /**
   * Cash out `percent` (10..100) of the REMAINING position at the current
   * multiplier — solpump's "Progressive Cashout". 100% (default) exits the
   * round; partials keep the rest riding.
   */
  cashOut(userId: string, percent = 100): { payoutLamports: bigint; multiplier: number; remainingLamports: bigint } {
    if (this.current.phase !== 'running') {
      throw new Error('Cash out only allowed while running');
    }
    const pct = Math.min(100, Math.max(1, Math.floor(percent)));
    const bet = this.current.bets.get(userId);
    if (!bet) throw new Error('No bet to cash out');
    if (bet.cashedOutAt !== null || bet.amountLamports === BigInt(0)) {
      throw new Error('Already cashed out');
    }

    const m = this.currentMultiplier();
    if (m >= this.current.bustPoint) throw new Error('Too late — round already busting');

    const portion =
      pct >= 100 ? bet.amountLamports : (bet.amountLamports * BigInt(pct)) / BigInt(100);
    if (portion <= BigInt(0)) throw new Error('Position too small to split');

    const payout = (portion * BigInt(Math.floor(m * 100))) / BigInt(100);
    bet.amountLamports -= portion;
    bet.payoutLamports += payout;
    if (bet.amountLamports === BigInt(0)) bet.cashedOutAt = m; // fully out

    this.gateway.emitCashedOut(this.current.id, {
      userId,
      // Name fields ride along so the curve can label the cashout marker.
      username: bet.username,
      walletAddress: bet.walletAddress,
      multiplier: m,
      payoutLamports: payout.toString(),
      remainingLamports: bet.amountLamports.toString(),
    });
    return { payoutLamports: payout, multiplier: m, remainingLamports: bet.amountLamports };
  }

  // ---------- Internal loop ----------

  private currentMultiplier(): number {
    if (this.current.phase !== 'running' || this.current.startedAt === null) return 1.0;
    const dt = Date.now() - this.current.startedAt;
    // m(t_ms) = 1.00024^t — same curve as @scadium/fair:crashMultiplierAt
    const m = Math.max(1.0, 1.00024 ** dt);
    return Number(m.toFixed(2));
  }

  private async startNewRound(): Promise<void> {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 0;
    const bustPoint = crashPoint(serverSeed, clientSeed, nonce);

    const seed = await this.prisma.seed.create({
      data: {
        serverSeed,
        serverSeedHash: commitServerSeed(serverSeed),
        clientSeed,
        nonce,
      },
    });

    const round = await this.prisma.crashRound.create({
      data: {
        seedId: seed.id,
        nonce,
        status: 'waiting',
      },
    });

    this.current = {
      id: round.id,
      seedId: seed.id,
      serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      bustPoint,
      phase: 'waiting',
      startedAt: null,
      bets: new Map(),
    };

    this.gateway.emitRoundStart({
      roundId: this.current.id,
      phase: 'waiting',
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      bettingWindowMs: CRASH.BET_WINDOW_MS,
    });

    // Drain scheduled bets into the fresh round. Balances were debited at
    // schedule time, so placement cannot fail; emit AFTER round-start so
    // clients see the bets land in the new round.
    for (const queued of this.nextRoundBets.values()) {
      try {
        this.placeBet(queued);
      } catch (e) {
        this.logger.error(
          `scheduled bet for ${queued.userId} failed to place: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    this.nextRoundBets.clear();

    // Betting window → run
    setTimeout(() => {
      void this.beginRun();
    }, CRASH.BET_WINDOW_MS);
  }

  private async beginRun(): Promise<void> {
    this.current.phase = 'running';
    this.current.startedAt = Date.now();
    await this.prisma.crashRound.update({
      where: { id: this.current.id },
      data: { status: 'running', startedAt: new Date(this.current.startedAt) },
    });
    this.gateway.emitRunning(this.current.id);

    // Tick loop at 20 Hz — server authoritative
    const tickInterval = 1000 / CRASH.TICK_RATE_HZ;
    const tick = () => {
      const m = this.currentMultiplier();

      // Auto-cashouts (full exit of whatever is still riding)
      for (const bet of this.current.bets.values()) {
        if (
          bet.cashedOutAt === null &&
          bet.amountLamports > BigInt(0) &&
          bet.autoCashout !== null &&
          m >= bet.autoCashout
        ) {
          try {
            this.cashOut(bet.userId);
          } catch {
            /* noop */
          }
        }
      }

      if (m >= this.current.bustPoint) {
        void this.bust();
        return;
      }
      this.gateway.emitTick(this.current.id, m);
      setTimeout(tick, tickInterval);
    };
    setTimeout(tick, tickInterval);
  }

  private async bust(): Promise<void> {
    this.current.phase = 'busted';
    const bustM = this.current.bustPoint;
    this.history.unshift({ bustPoint: bustM, roundId: this.current.id });
    this.history = this.history.slice(0, 50);

    // Settle the ledger for all bets. The `busted` round flip + seed reveal now
    // happen INSIDE this transaction (see settleRound) so a round is never
    // marked terminal without its ledger writes landing atomically.
    const settled = await this.settleRound();

    if (!settled) {
      // Unrecoverable settlement failure: the round stays non-terminal
      // (status left 'running'/'waiting', seed unrevealed) for the recovery
      // worker. Do NOT emit bust and do NOT advance to a new round.
      return;
    }

    this.gateway.emitBust({
      roundId: this.current.id,
      bustPoint: bustM,
      serverSeed: this.current.serverSeed,
    });

    // Fire on-chain settlement receipts AFTER the ledger tx commits
    // (fire-and-forget — never blocks the loop; no-op when disabled).
    if (this.chain.enabled) {
      for (const job of settled.settleJobs) {
        void this.chain
          .settleBet({
            betId: job.betId,
            walletAddress: job.walletAddress,
            game: 'crash',
            stakeLamports: job.stake,
            payoutLamports: job.payout,
            multiplier: job.multiplier,
          })
          .then(async (sig) => {
            if (sig) {
              await this.prisma.bet.update({
                where: { id: job.betId },
                data: { txSignature: sig },
              });
            }
          })
          .catch((e: unknown) =>
            this.logger.error(`on-chain settle failed for ${job.betId}: ${String(e)}`),
          );
      }
    }

    // Short gap then next round — ONLY on a committed settlement.
    setTimeout(() => {
      void this.startNewRound();
    }, 3_000);
  }

  /**
   * Settle every bet of the busted round in ONE serializable transaction:
   * per-user ledger update + CrashBet row + Bet row + the round `busted` flip +
   * the seed reveal. Returns the on-chain settle jobs (data only) on success,
   * or null if the transaction failed after retries (a SettlementFailure
   * dead-letter row is written and the round is left non-terminal).
   */
  private async settleRound(): Promise<{
    settleJobs: {
      betId: string;
      walletAddress: string;
      stake: bigint;
      payout: bigint;
      multiplier: number;
    }[];
  } | null> {
    const bets = Array.from(this.current.bets.values());
    const bustM = this.current.bustPoint;

    // Pre-generate bet ids so the post-commit on-chain receipts can reference
    // them without re-querying, and collect chain jobs as DATA ONLY.
    const settleJobs: {
      betId: string;
      walletAddress: string;
      stake: bigint;
      payout: bigint;
      multiplier: number;
    }[] = bets.map((bet) => ({
      betId: randomUUID(),
      walletAddress: bet.walletAddress,
      stake: bet.originalAmountLamports,
      payout: bet.payoutLamports,
      multiplier: bet.cashedOutAt ?? bustM,
    }));

    try {
      await withSerializable(this.prisma, async (tx) => {
        for (let i = 0; i < bets.length; i += 1) {
          const bet = bets[i]!;
          const job = settleJobs[i]!;
          // Progressive cashout: payouts accumulated across partial exits; any
          // stake still riding at bust is lost. won = walked away with anything.
          const stake = bet.originalAmountLamports;
          const payout = bet.payoutLamports;
          const won = payout > BigInt(0);
          const netProfit = payout - stake;

          await tx.user.update({
            where: { id: bet.userId },
            data: {
              // Wager mining: 128 SCAD per SOL wagered (base units = lamports × 128)
              scadiumBalance: { increment: stake * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT) },
              totalWagered: { increment: stake },
              totalWon: { increment: netProfit > BigInt(0) ? netProfit : BigInt(0) },
              totalLost: { increment: netProfit < BigInt(0) ? -netProfit : BigInt(0) },
              gamesPlayed: { increment: 1 },
            },
          });

          // Credit the play balance through the single mutation point (writes a
          // ledger row in this tx). Only when there's an actual payout — a pure
          // loss has no balance movement.
          if (payout > BigInt(0)) {
            await applyBalanceDelta(tx, bet.userId, payout, {
              reason: 'crash_settle',
              refType: 'Bet',
              refId: job.betId,
            });
          }

          await tx.crashBet.create({
            data: {
              roundId: this.current.id,
              userId: bet.userId,
              amountLamports: stake,
              autoCashoutMultiplier: bet.autoCashout,
              cashoutMultiplier: bet.cashedOutAt,
              payoutLamports: payout,
              won,
            },
          });

          await tx.bet.create({
            data: {
              id: job.betId,
              userId: bet.userId,
              gameType: 'crash',
              amountLamports: stake,
              payoutLamports: payout,
              multiplier:
                stake > BigInt(0) && payout > BigInt(0)
                  ? Number(payout) / Number(stake)
                  : bet.cashedOutAt ?? bustM,
              status: won ? 'won' : 'lost',
              seedId: this.current.seedId,
              nonce: this.current.nonce,
              resultJson: {
                bustPoint: bustM,
                cashedOutAt: bet.cashedOutAt,
                partialPayouts: payout.toString(),
              },
            },
          });
        }

        // Round terminal flip + seed reveal: INSIDE the tx so the round can
        // never be 'busted' without its ledger writes (and vice versa).
        await tx.crashRound.update({
          where: { id: this.current.id },
          data: { status: 'busted', bustMultiplier: bustM, endedAt: new Date() },
        });
        await tx.seed.update({
          where: { id: this.current.seedId },
          data: { revealedAt: new Date() },
        });
      });
    } catch (e) {
      this.logger.error(
        `Failed to settle crash round ${this.current.id} after retries: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      // Best-effort dead-letter write — must never crash the loop itself.
      try {
        await this.prisma.settlementFailure.create({
          data: {
            gameType: 'crash',
            roundId: this.current.id,
            payloadJson: {
              roundId: this.current.id,
              bustPoint: bustM,
              bets: bets.map((b) => ({
                userId: b.userId,
                stake: b.originalAmountLamports.toString(),
                payout: b.payoutLamports.toString(),
                cashedOutAt: b.cashedOutAt,
                autoCashout: b.autoCashout,
              })),
            },
            error: e instanceof Error ? e.message : String(e),
          },
        });
      } catch (deadLetterErr) {
        this.logger.error(
          `Failed to write SettlementFailure for crash round ${this.current.id}: ${String(
            deadLetterErr,
          )}`,
        );
      }
      return null;
    }

    return { settleJobs };
  }
}
