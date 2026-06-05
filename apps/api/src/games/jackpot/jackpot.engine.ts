import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  commitServerSeed,
  generateClientSeed,
  generateServerSeed,
  jackpotWinningTicket,
} from '@scadium/fair';
import { JACKPOT } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { JackpotGateway } from './jackpot.gateway';

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
export class JackpotEngine implements OnModuleInit {
  private readonly logger = new Logger(JackpotEngine.name);
  private current!: CurrentRound;
  private lastResult: LastResult | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: JackpotGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.openNewRound();
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
    const roundId = this.current.id;
    const { serverSeed, clientSeed, nonce, seedId } = this.current;

    const entries = await this.prisma.jackpotEntry.findMany({
      where: { roundId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, username: true } } },
    });

    const distinctPlayers = new Set(entries.map((e) => e.userId));
    const total = entries.reduce((s, e) => s + e.amountLamports, BigInt(0));

    await this.prisma.seed.update({ where: { id: seedId }, data: { revealedAt: new Date() } });

    // Not enough distinct players → refund everyone, roll the round over.
    if (distinctPlayers.size < JACKPOT.MIN_PLAYERS) {
      this.current.status = 'refunded';
      const ops: Promise<unknown>[] = entries.map((e) =>
        this.prisma.user.update({
          where: { id: e.userId },
          data: { playBalanceLamports: { increment: e.amountLamports } },
        }),
      );
      ops.push(
        this.prisma.jackpotRound.update({
          where: { id: roundId },
          data: { status: 'refunded', totalLamports: total, drawnAt: new Date() },
        }),
      );
      await Promise.allSettled(ops);

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
      await this.openNewRound();
      return;
    }

    // Draw the winning ticket and walk cumulative ranges to find the winner.
    this.current.status = 'drawn';
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
    const byUser = new Map<string, { amount: bigint; username: string | null }>();
    for (const e of entries) {
      const cur = byUser.get(e.userId) ?? { amount: BigInt(0), username: e.user.username };
      cur.amount += e.amountLamports;
      byUser.set(e.userId, cur);
    }

    const ops: Promise<unknown>[] = [];
    for (const [userId, info] of byUser) {
      const won = userId === winner.userId;
      const credited = won ? payout : BigInt(0);
      const profit = credited - info.amount;
      ops.push(
        this.prisma.user.update({
          where: { id: userId },
          data: {
            playBalanceLamports: { increment: credited },
            totalWagered: { increment: info.amount },
            totalWon: { increment: profit > BigInt(0) ? profit : BigInt(0) },
            totalLost: { increment: profit < BigInt(0) ? -profit : BigInt(0) },
            gamesPlayed: { increment: 1 },
          },
        }),
      );
      ops.push(
        this.prisma.bet.create({
          data: {
            userId,
            gameType: 'jackpot',
            amountLamports: info.amount,
            payoutLamports: credited,
            multiplier: info.amount > BigInt(0) ? Number(credited) / Number(info.amount) : 0,
            status: won ? 'won' : 'lost',
            seedId,
            nonce,
            resultJson: { totalLamports: total.toString(), winningTicket: ticket, won },
          },
        }),
      );
    }
    ops.push(
      this.prisma.jackpotRound.update({
        where: { id: roundId },
        data: {
          status: 'drawn',
          totalLamports: total,
          winnerId: winner.userId,
          winningTicket: BigInt(ticket),
          payoutLamports: payout,
          drawnAt: new Date(),
        },
      }),
    );

    try {
      await Promise.all(ops);
    } catch (e) {
      this.logger.error(`Jackpot settle failed: ${e instanceof Error ? e.message : e}`);
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
    await this.openNewRound();
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
