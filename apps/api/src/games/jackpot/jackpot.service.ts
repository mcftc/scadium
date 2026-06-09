import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JACKPOT } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { JackpotEngine } from './jackpot.engine';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { claimIdempotency, storeIdempotency } from '../../prisma/idempotency';

/**
 * HTTP facade for the jackpot. Validates entries, debits the play-money
 * balance pessimistically, persists the entry, and registers it with the
 * engine. Composes the live snapshot (round meta + per-player contributions).
 */
@Injectable()
export class JackpotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: JackpotEngine,
  ) {}

  async snapshot() {
    const meta = this.engine.meta();
    const entries = await this.prisma.jackpotEntry.findMany({
      where: { roundId: meta.roundId },
      include: { user: { select: { id: true, username: true, walletAddress: true } } },
    });

    // Aggregate contributions per player + win odds (share of pot).
    const total = entries.reduce((s, e) => s + e.amountLamports, BigInt(0));
    const byUser = new Map<
      string,
      { username: string | null; walletAddress: string; amount: bigint }
    >();
    for (const e of entries) {
      const cur =
        byUser.get(e.userId) ??
        { username: e.user.username, walletAddress: e.user.walletAddress, amount: BigInt(0) };
      cur.amount += e.amountLamports;
      byUser.set(e.userId, cur);
    }
    const players = [...byUser.entries()]
      .map(([userId, p]) => ({
        userId,
        username: p.username,
        walletAddress: p.walletAddress,
        amountLamports: p.amount.toString(),
        chance: total > BigInt(0) ? Number((Number(p.amount) / Number(total)).toFixed(4)) : 0,
      }))
      .sort((a, b) => Number(b.amountLamports) - Number(a.amountLamports));

    return { ...meta, players };
  }

  async enter(params: { userId: string; amountLamports: bigint }, key?: string) {
    const amount = params.amountLamports;
    if (
      amount < BigInt(JACKPOT.MIN_ENTRY_LAMPORTS) ||
      amount > BigInt(JACKPOT.MAX_ENTRY_LAMPORTS)
    ) {
      throw new BadRequestException('Entry out of range');
    }

    const open = this.engine.getOpenRound();
    if (!open) throw new BadRequestException('No open round — the next one starts shortly');

    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('Account banned');

    const outcome = await this.prisma.$transaction(async (tx) => {
      const replay = await claimIdempotency(tx, params.userId, 'jackpot_enter', key);
      if (replay) return { response: replay as ReturnType<typeof this.serializeEnter>, replayed: true };

      // Atomic conditional debit inside the tx — closes the double-spend race.
      await applyBalanceDelta(tx, params.userId, -amount, {
        reason: 'jackpot_entry',
        refType: 'JackpotRound',
        refId: open.id,
      });
      try {
        await tx.jackpotEntry.create({
          data: { roundId: open.id, userId: params.userId, amountLamports: amount },
        });
      } catch (e) {
        // Unique (roundId, userId): reject a second entry with a clear 400.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new BadRequestException('Already entered this round');
        }
        throw e;
      }

      const response = this.serializeEnter(open.id, amount);
      await storeIdempotency(tx, params.userId, 'jackpot_enter', key, response);
      return { response, replayed: false };
    });

    // Skip the engine update on replay — the original entry already registered it.
    if (!outcome.replayed) {
      await this.engine.onEntry({
        userId: user.id,
        username: user.username,
        walletAddress: user.walletAddress,
        amountLamports: amount,
      });
    }

    return outcome.response;
  }

  private serializeEnter(roundId: string, amount: bigint) {
    return { ok: true, roundId, amountLamports: amount.toString() };
  }

  async myEntries(userId: string, limit = 20) {
    const rounds = await this.prisma.jackpotRound.findMany({
      where: { entries: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { entries: { where: { userId } } },
    });
    return rounds.map((r) => {
      const myAmount = r.entries.reduce((s, e) => s + e.amountLamports, BigInt(0));
      const won = r.winnerId === userId;
      return {
        roundId: r.id,
        status: r.status,
        myAmountLamports: myAmount.toString(),
        totalLamports: r.totalLamports.toString(),
        won,
        payoutLamports: won ? r.payoutLamports.toString() : '0',
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async recent(limit = 10) {
    const rounds = await this.prisma.jackpotRound.findMany({
      where: { status: { in: ['drawn', 'refunded'] } },
      orderBy: { drawnAt: 'desc' },
      take: limit,
      include: {
        seed: true,
        winner: { select: { username: true, walletAddress: true } },
      },
    });
    return rounds.map((r) => ({
      id: r.id,
      status: r.status,
      totalLamports: r.totalLamports.toString(),
      payoutLamports: r.payoutLamports.toString(),
      winningTicket: r.winningTicket?.toString() ?? null,
      winnerName: r.winner?.username ?? null,
      winnerWallet: r.winner?.walletAddress ?? null,
      drawnAt: r.drawnAt?.toISOString() ?? null,
      serverSeed: r.seed.serverSeed,
      serverSeedHash: r.seed.serverSeedHash,
      clientSeed: r.seed.clientSeed,
      nonce: r.nonce,
    }));
  }
}
