import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  commitServerSeed,
  generateClientSeed,
  generateServerSeed,
  jackpotWinningTicket,
} from '@scadium/fair';
import { JACKPOT, SCAD } from '@scadium/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializable } from '../../prisma/with-serializable';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { ChainService } from '../../solana/chain.service';
import { RedisService } from '../../redis/redis.service';
import { LeaderElection } from '../../redis/leader-election';
import { JackpotGateway } from './jackpot.gateway';

// Single-writer election (#13/#86): only the lock holder opens/draws rounds, so
// N replicas never produce duplicate JackpotRound rows. No Redis → always leader.
const JACKPOT_LOCK_KEY = 'lock:engine:jackpot';
const JACKPOT_LOCK_TTL_MS = 10_000;

interface CurrentRound {
  id: string;
  seedId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  closeAt: number;
  status: 'open' | 'drawn' | 'refunded';
  totalLamports: bigint;
  players: Set<string>; // distinct userIds (for the live player count)
}

interface LastResult {
  roundId: string;
  status: 'drawn' | 'refunded';
  winnerName: string | null;
  payoutLamports: string;
  totalLamports: string;
  winningTicket: string | null;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  drawnAt: number;
}

/**
 * Singleton jackpot scheduler (pot-style raffle). A round opens, players add
 * SOL entries for ROUND_WINDOW_MS, then a provably-fair ticket in
 * [0, totalLamports) selects the winner — the player whose cumulative
 * contribution range contains the ticket takes 95% of the pot. Fewer than
 * MIN_PLAYERS distinct players → everyone is refunded and the round rolls over.
 *
 * Like the crash/lottery engines it owns the only live round in memory and
 * settles from the DB so a restart can't lose entries.
 */
@Injectable()
export class JackpotEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JackpotEngine.name);
  private current!: CurrentRound;
  private lastResult: LastResult | null = null;
  private election: LeaderElection | null = null;
  /** True while replaying stranded rounds on boot — suppresses the chained
   * openNewRound() in drawAndSettle so onModuleInit opens exactly one fresh
   * round after all stranded rounds settle. */
  private recovering = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: JackpotGateway,
    private readonly chain: ChainService,
    private readonly redis?: RedisService,
  ) {
    if (this.redis) {
      this.election = new LeaderElection(this.redis.client, JACKPOT_LOCK_KEY, JACKPOT_LOCK_TTL_MS);
    }
  }

  /** Only the elected leader opens/draws rounds. No Redis = always leader. */
  isLeader(): boolean {
    return this.election ? this.election.isLeader() : true;
  }

  async onModuleInit(): Promise<void> {
    if (!this.election) {
      await this.recoverStrandedRounds();
      await this.openNewRound();
      return;
    }
    // Multi-instance: placeholder keeps reads safe until we lead; only the leader
    // opens rounds. (Cross-pod live state is wired in #87.)
    this.current = this.placeholderRound();
    // Acquire synchronously so a single instance has an open round before init
    // resolves; start() then fires only on later leadership transitions.
    await this.election.tick();
    if (this.isLeader()) await this.assumeLeadership();
    this.election.start((leader) => {
      if (leader) void this.assumeLeadership();
      else this.logger.warn('jackpot: lost leadership — standing by');
    });
  }

  private placeholderRound(): CurrentRound {
    return {
      id: '',
      seedId: '',
      serverSeed: '',
      serverSeedHash: '',
      clientSeed: '',
      nonce: 0,
      closeAt: 0,
      status: 'open',
      totalLamports: BigInt(0),
      players: new Set(),
    };
  }

  private async assumeLeadership(): Promise<void> {
    this.logger.log('jackpot: elected leader — driving rounds');
    await this.recoverStrandedRounds();
    await this.openNewRound();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.election) await this.election.stop();
  }

  /**
   * Boot recovery (#14): a restart strands every round left 'open' — its
   * entries are debited but never drawn/refunded, and the round sits 'open'
   * forever. For each, reconstruct `this.current` from the DB round + its Seed
   * and call the existing transactional `drawAndSettle()`, which draws (≥
   * MIN_PLAYERS) or refunds (< MIN_PLAYERS) atomically with ledger entries and
   * marks the round terminal. NOTE: drawAndSettle calls openNewRound at the end,
   * so we set a flag to suppress that during recovery (onModuleInit opens the
   * fresh round once, after all stranded rounds are settled). Per-round
   * try/catch → SettlementFailure on error, continue.
   */
  private async recoverStrandedRounds(): Promise<void> {
    let stranded: { id: string; seedId: string }[];
    try {
      stranded = await this.prisma.jackpotRound.findMany({
        where: { status: 'open' },
        select: { id: true, seedId: true },
        orderBy: { createdAt: 'asc' },
      });
    } catch (e) {
      this.logger.error(
        `jackpot recovery scan failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (stranded.length === 0) return;
    this.logger.warn(`jackpot recovery: ${stranded.length} stranded round(s) — settling`);

    this.recovering = true;
    try {
      for (const r of stranded) {
        try {
          const seed = await this.prisma.seed.findUniqueOrThrow({ where: { id: r.seedId } });
          this.current = {
            id: r.id,
            seedId: seed.id,
            serverSeed: seed.serverSeed ?? '',
            serverSeedHash: seed.serverSeedHash,
            clientSeed: seed.clientSeed,
            nonce: seed.nonce,
            closeAt: Date.now(),
            status: 'open',
            totalLamports: BigInt(0),
            players: new Set(),
          };
          await this.drawAndSettle();
          this.logger.log(`jackpot recovery: round ${r.id} settled`);
        } catch (e) {
          await this.recordSettlementFailure(r.id, e, { roundId: r.id, path: 'recovery' });
        }
      }
    } finally {
      this.recovering = false;
    }
  }

  getOpenRound(): { id: string; closeAt: number } | null {
    if (this.current.status !== 'open' || Date.now() >= this.current.closeAt) return null;
    return { id: this.current.id, closeAt: this.current.closeAt };
  }

  /** Update live tallies after an entry is persisted. */
  async onEntry(params: {
    userId: string;
    username: string | null;
    walletAddress: string;
    amountLamports: bigint;
  }): Promise<void> {
    this.current.totalLamports += params.amountLamports;
    this.current.players.add(params.userId);
    await this.prisma.jackpotRound.update({
      where: { id: this.current.id },
      data: { totalLamports: this.current.totalLamports },
    });
    this.gateway.emitEntry({
      roundId: this.current.id,
      userId: params.userId,
      username: params.username,
      walletAddress: params.walletAddress,
      amountLamports: params.amountLamports.toString(),
      totalLamports: this.current.totalLamports.toString(),
      playerCount: this.current.players.size,
    });
  }

  meta() {
    return {
      roundId: this.current.id,
      status: this.current.status,
      serverSeedHash: this.current.serverSeedHash,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      closeAt: this.current.closeAt,
      totalLamports: this.current.totalLamports.toString(),
      playerCount: this.current.players.size,
      config: {
        minEntryLamports: JACKPOT.MIN_ENTRY_LAMPORTS.toString(),
        maxEntryLamports: JACKPOT.MAX_ENTRY_LAMPORTS.toString(),
        houseEdge: JACKPOT.HOUSE_EDGE,
        minPlayers: JACKPOT.MIN_PLAYERS,
      },
      lastResult: this.lastResult,
    };
  }

  // ---------- Scheduler ----------

  private async openNewRound(): Promise<void> {
    if (!this.isLeader()) return; // never open a round as a non-leader
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 0;

    const seed = await this.prisma.seed.create({
      data: { serverSeed, serverSeedHash: commitServerSeed(serverSeed), clientSeed, nonce },
    });

    const closeAt = Date.now() + JACKPOT.ROUND_WINDOW_MS;
    const round = await this.prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce, status: 'open', closeAt: new Date(closeAt) },
    });

    this.current = {
      id: round.id,
      seedId: seed.id,
      serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      closeAt,
      status: 'open',
      totalLamports: BigInt(0),
      players: new Set(),
    };

    this.gateway.emitRoundOpen({
      roundId: round.id,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce,
      closeAt,
    });

    setTimeout(() => void this.drawAndSettle(), JACKPOT.ROUND_WINDOW_MS);
  }

  private async drawAndSettle(): Promise<void> {
    if (!this.isLeader()) return; // only the leader settles
    const roundId = this.current.id;
    const { serverSeed, clientSeed, nonce, seedId } = this.current;

    const entries = await this.prisma.jackpotEntry.findMany({
      where: { roundId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, username: true, walletAddress: true } } },
    });

    const distinctPlayers = new Set(entries.map((e) => e.userId));
    const total = entries.reduce((s, e) => s + e.amountLamports, BigInt(0));

    // Not enough distinct players → refund everyone, roll the round over.
    if (distinctPlayers.size < JACKPOT.MIN_PLAYERS) {
      // Refund every entry + flip the round 'refunded' + reveal the seed in ONE
      // serializable transaction — no partial refunds, no terminal-without-money.
      try {
        await withSerializable(this.prisma, async (tx) => {
          for (const e of entries) {
            await applyBalanceDelta(tx, e.userId, e.amountLamports, {
              reason: 'jackpot_refund',
              refType: 'JackpotRound',
              refId: roundId,
            });
          }
          await tx.jackpotRound.update({
            where: { id: roundId },
            data: { status: 'refunded', totalLamports: total, drawnAt: new Date() },
          });
          await tx.seed.update({ where: { id: seedId }, data: { revealedAt: new Date() } });
        });
      } catch (e) {
        await this.recordSettlementFailure(roundId, e, {
          roundId,
          path: 'refund',
          total: total.toString(),
          entries: entries.map((en) => ({
            userId: en.userId,
            amount: en.amountLamports.toString(),
          })),
        });
        // Leave the round non-terminal (status stays 'open' in the DB) and do
        // NOT open a new round — the recovery worker re-settles it.
        return;
      }

      this.current.status = 'refunded';
      this.setLastResult({ roundId, status: 'refunded', winnerName: null, payout: BigInt(0), total, ticket: null });
      this.gateway.emitDrawResult({
        roundId,
        status: 'refunded',
        winnerId: null,
        winnerName: null,
        payoutLamports: '0',
        totalLamports: total.toString(),
        winningTicket: null,
        serverSeed,
      });
      this.logger.log(`Jackpot ${roundId} refunded (${distinctPlayers.size} players)`);
      if (!this.recovering) await this.openNewRound();
      return;
    }

    // Draw the winning ticket and walk cumulative ranges to find the winner.
    const ticket = jackpotWinningTicket(serverSeed, clientSeed, nonce, Number(total));
    let cumulative = 0;
    let winner = entries[0]!;
    for (const e of entries) {
      cumulative += Number(e.amountLamports);
      if (ticket < cumulative) {
        winner = e;
        break;
      }
    }

    const payout =
      (total * BigInt(Math.round((1 - JACKPOT.HOUSE_EDGE) * 1000))) / BigInt(1000);

    // Per-user contribution totals for ledger aggregates + Bet rows.
    const byUser = new Map<
      string,
      { amount: bigint; username: string | null; walletAddress: string }
    >();
    for (const e of entries) {
      const cur =
        byUser.get(e.userId) ??
        ({
          amount: BigInt(0),
          username: e.user.username,
          walletAddress: e.user.walletAddress,
        } as { amount: bigint; username: string | null; walletAddress: string });
      cur.amount += e.amountLamports;
      byUser.set(e.userId, cur);
    }

    // Pre-generate bet ids + collect on-chain settle jobs as DATA ONLY; the
    // chain calls fire AFTER the tx commits.
    const settleJobs: {
      betId: string;
      walletAddress: string;
      stake: bigint;
      payout: bigint;
      multiplier: number;
    }[] = [];
    for (const [, info] of byUser) {
      settleJobs.push({
        betId: randomUUID(),
        walletAddress: info.walletAddress,
        stake: info.amount,
        payout: BigInt(0), // filled below per winner/loser
        multiplier: 0,
      });
    }

    // Settle every player (ledger update + Bet row) + the round 'drawn' flip +
    // the seed reveal in ONE serializable transaction.
    try {
      await withSerializable(this.prisma, async (tx) => {
        let i = 0;
        for (const [userId, info] of byUser) {
          const job = settleJobs[i]!;
          i += 1;
          const won = userId === winner.userId;
          const credited = won ? payout : BigInt(0);
          const profit = credited - info.amount;
          const multiplier = info.amount > BigInt(0) ? Number(credited) / Number(info.amount) : 0;
          job.payout = credited;
          job.multiplier = multiplier;

          await tx.user.update({
            where: { id: userId },
            data: {
              scadiumBalance: {
                increment: info.amount * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT),
              },
              totalWagered: { increment: info.amount },
              totalWon: { increment: profit > BigInt(0) ? profit : BigInt(0) },
              totalLost: { increment: profit < BigInt(0) ? -profit : BigInt(0) },
              gamesPlayed: { increment: 1 },
            },
          });
          // Credit the play balance through the single mutation point (ledger
          // row in this tx). Only the winner is credited; losers move nothing.
          if (credited > BigInt(0)) {
            await applyBalanceDelta(tx, userId, credited, {
              reason: 'jackpot_settle',
              refType: 'Bet',
              refId: job.betId,
            });
          }
          await tx.bet.create({
            data: {
              id: job.betId,
              userId,
              gameType: 'jackpot',
              amountLamports: info.amount,
              payoutLamports: credited,
              multiplier,
              status: won ? 'won' : 'lost',
              seedId,
              nonce,
              resultJson: {
                totalLamports: total.toString(),
                winningTicket: ticket,
                won,
                // Self-contained verification context (ADR 0001 / #93).
                fair: {
                  serverSeed: this.current.serverSeed,
                  serverSeedHash: this.current.serverSeedHash,
                  clientSeed: this.current.clientSeed,
                  nonce: this.current.nonce,
                },
              },
            },
          });
        }
        await tx.jackpotRound.update({
          where: { id: roundId },
          data: {
            status: 'drawn',
            totalLamports: total,
            winnerId: winner.userId,
            winningTicket: BigInt(ticket),
            payoutLamports: payout,
            drawnAt: new Date(),
          },
        });
        await tx.seed.update({ where: { id: seedId }, data: { revealedAt: new Date() } });
      });
    } catch (e) {
      await this.recordSettlementFailure(roundId, e, {
        roundId,
        path: 'draw',
        total: total.toString(),
        winnerId: winner.userId,
        winningTicket: ticket,
        payout: payout.toString(),
        players: [...byUser.entries()].map(([userId, info]) => ({
          userId,
          amount: info.amount.toString(),
        })),
      });
      // Leave the round non-terminal and do NOT open a new round.
      return;
    }

    this.current.status = 'drawn';

    // On-chain settlement receipts AFTER the bet rows commit (fire-and-forget,
    // no-op when disabled — never blocks the round loop).
    if (this.chain.enabled) {
      for (const job of settleJobs) {
        void this.chain
          .settleBet({
            betId: job.betId,
            walletAddress: job.walletAddress,
            game: 'jackpot',
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

    const winnerName = winner.user.username;
    this.setLastResult({ roundId, status: 'drawn', winnerName, payout, total, ticket });
    this.gateway.emitDrawResult({
      roundId,
      status: 'drawn',
      winnerId: winner.userId,
      winnerName,
      payoutLamports: payout.toString(),
      totalLamports: total.toString(),
      winningTicket: String(ticket),
      serverSeed,
    });
    this.logger.log(
      `Jackpot ${roundId} → winner ${winnerName ?? winner.userId} takes ${payout} of ${total}`,
    );
    if (!this.recovering) await this.openNewRound();
  }

  /**
   * Best-effort dead-letter write when a settlement exhausts its retries. Must
   * never throw — a logging failure can't be allowed to crash the round loop.
   */
  private async recordSettlementFailure(
    roundId: string,
    error: unknown,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Jackpot settle failed for ${roundId} after retries: ${message}`);
    try {
      await this.prisma.settlementFailure.create({
        data: {
          gameType: 'jackpot',
          roundId,
          payloadJson: payload as object,
          error: message,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to write SettlementFailure for jackpot ${roundId}: ${String(e)}`);
    }
  }

  private setLastResult(p: {
    roundId: string;
    status: 'drawn' | 'refunded';
    winnerName: string | null;
    payout: bigint;
    total: bigint;
    ticket: number | null;
  }): void {
    this.lastResult = {
      roundId: p.roundId,
      status: p.status,
      winnerName: p.winnerName,
      payoutLamports: p.payout.toString(),
      totalLamports: p.total.toString(),
      winningTicket: p.ticket === null ? null : String(p.ticket),
      serverSeed: this.current.serverSeed,
      serverSeedHash: this.current.serverSeedHash,
      clientSeed: this.current.clientSeed,
      nonce: this.current.nonce,
      drawnAt: Date.now(),
    };
  }
}
