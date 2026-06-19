import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LOTTERY, bulkDiscountTotal, scadBaseToLamports } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainService } from '../../solana/chain.service';
import { LotteryEngine } from './lottery.engine';
import { RgService } from '../../responsible-gambling/rg.service';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { claimIdempotency, storeIdempotency } from '../../prisma/idempotency';

const SCAD_BASE = 10 ** LOTTERY.SCAD_DECIMALS;

/**
 * HTTP-facing facade for the PancakeSwap-style $SCAD lottery. Validates ticket
 * picks (6 digits 0..9), debits the play-money balance (off-chain) or confirms
 * a user-signed on-chain $SCAD purchase, persists the ticket, and registers it
 * with the engine. The debit is pessimistic so balance can't be double-spent.
 */
@Injectable()
export class LotteryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: LotteryEngine,
    private readonly chain: ChainService,
    private readonly rg: RgService,
  ) {}

  snapshot() {
    return this.engine.snapshot();
  }

  /** Bulk-discounted $SCAD price for buying N tickets this round. */
  bulkPrice(n: number) {
    const unit = this.engine.ticketPriceScadBase();
    const total = bulkDiscountTotal(unit, n);
    const full = unit * BigInt(n);
    const discountBps = full > 0n ? Number(((full - total) * 10_000n) / full) : 0;
    return {
      count: n,
      unitScadBase: unit.toString(),
      totalScadBase: total.toString(),
      totalScad: Number(total) / SCAD_BASE,
      discountBps,
    };
  }

  async forceDraw(userId: string) {
    await this.assertAdmin(userId);
    return this.engine.forceDraw();
  }

  private async assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role !== 'admin') throw new ForbiddenException('Admin access required');
  }

  private validateDigits(digits: number[]) {
    if (
      digits.length !== LOTTERY.DIGITS ||
      digits.some((d) => d < 0 || d > 9 || !Number.isInteger(d))
    ) {
      throw new BadRequestException('Ticket must be 6 digits, each 0..9');
    }
  }

  /**
   * On-chain purchase confirmation: the web buys via a USER-signed
   * buy_ticket(s) transaction (paid in $SCAD), then posts the signature here.
   * We fetch the tx, decode the TicketBought events, and only then persist —
   * the chain is the source of truth. The bulk discount applied on-chain is
   * mirrored here (price split equally across the batch).
   */
  async confirmTicket(params: { userId: string; signature: string }) {
    if (!this.chain.lotteryEnabled) {
      throw new BadRequestException('On-chain lottery is not enabled');
    }
    // Absolute blocks apply to the on-chain $SCAD purchase too (self-exclusion /
    // cooling-off / age gate #146); 0n since it is $SCAD-denominated, not SOL.
    await this.rg.assertCanWager(params.userId, 0n);
    const open = this.engine.getOpenDraw();
    if (!open) throw new BadRequestException('No open draw');

    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('Account banned');

    // One tx can carry many tickets (`buy_tickets` batch) — one event each.
    const events = await this.chain.verifyTicketTx(params.signature);
    if (events.length === 0) {
      throw new BadRequestException('Transaction not found or not a ticket purchase');
    }
    for (const event of events) {
      if (event.buyer !== user.walletAddress) {
        throw new BadRequestException('Ticket was bought by a different wallet');
      }
      if (event.drawIndex !== open.drawIndex) {
        throw new BadRequestException('Ticket belongs to a different draw');
      }
    }

    // The on-chain transfer was the bulk-discounted total of this batch.
    const totalScad = bulkDiscountTotal(this.engine.ticketPriceScadBase(), events.length);
    const perTicketScad = totalScad / BigInt(events.length);
    const perTicketLamports = scadBaseToLamports(perTicketScad);

    // @@unique([txSignature, txIndex]) makes replaying a signature impossible —
    // the transaction throws on the duplicate key before anything is recorded.
    const tickets = await this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const [txIndex, event] of events.entries()) {
        created.push(
          await tx.lotteryTicket.create({
            data: {
              drawId: open.id,
              userId: params.userId,
              digits: event.digits,
              costScadBase: perTicketScad,
              costLamports: perTicketLamports,
              txSignature: params.signature,
              txIndex,
            },
          }),
        );
      }
      // #215 — even an on-chain-confirmed buy can race the off-chain draw close:
      // if the draw is claimed terminal between getOpenDraw() and this commit the
      // tickets would be orphaned (recorded, but bracketed by no settle). Make the
      // whole tx conditional on the draw still being open. (The on-chain $SCAD
      // transfer already happened; a rejected confirm leaves it reconcilable via
      // the unique signature — re-confirm against the next open draw is blocked by
      // the drawIndex check above, so this surfaces the race to the buyer.)
      await this.assertDrawStillOpen(tx, open.id);
      return created;
    });
    await this.engine.onTicketSold(totalScad, scadBaseToLamports(totalScad), tickets.length);

    return {
      txSignature: params.signature,
      count: tickets.length,
      totalScad: Number(totalScad) / SCAD_BASE,
      tickets: tickets.map((t) => ({ id: t.id, drawId: t.drawId, digits: t.digits })),
    };
  }

  /**
   * Wager-loyalty free tickets: every 1 SOL of lifetime wager (any game)
   * earns one. Consuming a ticket advances the watermark by 1 SOL.
   */
  async freeTicketStatus(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const per = BigInt(LOTTERY.FREE_TICKET_PER_WAGER_LAMPORTS);
    const available = Number((user.totalWagered - user.freeTicketBaselineWagered) / per);
    const progress = Number((user.totalWagered - user.freeTicketBaselineWagered) % per);
    return {
      available: Math.max(0, available),
      progressLamports: progress.toString(),
      perWagerLamports: per.toString(),
    };
  }

  /** Spend one earned free ticket on the caller's picks (no $SCAD moves). */
  async useFreeTicket(params: { userId: string; digits: number[] }) {
    // Same absolute blocks as a paid ticket (self-exclusion / cooling-off /
    // age gate #146) — a free ticket is still a lottery entry (0n: no SOL wager).
    await this.rg.assertCanWager(params.userId, 0n);
    this.validateDigits(params.digits);
    const open = this.engine.getOpenDraw();
    if (!open) throw new BadRequestException('No open draw');

    const per = BigInt(LOTTERY.FREE_TICKET_PER_WAGER_LAMPORTS);
    const ticket = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: params.userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.banned) throw new ForbiddenException('Account banned');
      if (user.totalWagered - user.freeTicketBaselineWagered < per) {
        throw new BadRequestException('No free tickets earned yet — wager 1 SOL to earn one');
      }
      await tx.user.update({
        where: { id: params.userId },
        data: { freeTicketBaselineWagered: { increment: per } },
      });
      const created = await tx.lotteryTicket.create({
        data: {
          drawId: open.id,
          userId: params.userId,
          digits: params.digits,
          costLamports: BigInt(0),
          costScadBase: BigInt(0),
          free: true,
        },
      });
      // #215 — a free ticket is still a draw entry: if the draw is claimed
      // terminal between getOpenDraw() and this commit it would be orphaned
      // (consumed watermark + a ticket that no settle ever brackets). Make the
      // whole tx conditional on the draw still being open (rolls back the
      // watermark advance too).
      await this.assertDrawStillOpen(tx, open.id);
      return created;
    });
    await this.engine.onTicketSold(BigInt(0), BigInt(0));
    return { id: ticket.id, drawId: ticket.drawId, digits: ticket.digits, free: true };
  }

  /** Devnet convenience: top the caller up with demo $SCAD. */
  async scadFaucet(userId: string) {
    if (!this.chain.lotteryEnabled) {
      throw new BadRequestException('On-chain lottery is not enabled');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const amount = BigInt(100) * BigInt(SCAD_BASE); // 100 SCAD
    const sig = await this.chain.scadFaucet(user.walletAddress, amount);
    if (!sig) throw new BadRequestException('Faucet transfer failed');
    return { signature: sig, amountScadBase: amount.toString() };
  }

  async buyTicket(params: { userId: string; digits: number[] }, key?: string) {
    // Lottery tickets are $SCAD-denominated, so only the absolute blocks apply
    // (self-exclusion / cooling-off); the lamports daily limit does not (0n).
    await this.rg.assertCanWager(params.userId, 0n);
    // When the on-chain lottery is live, the play-money path is closed —
    // tickets must be real wallet-signed $SCAD purchases (POST /confirm).
    if (this.chain.lotteryEnabled) {
      throw new BadRequestException(
        'Tickets are bought on-chain with $SCAD — sign the purchase with your wallet',
      );
    }
    this.validateDigits(params.digits);

    const open = this.engine.getOpenDraw();
    if (!open) {
      throw new BadRequestException('No open draw — the next one starts shortly');
    }

    const priceScad = this.engine.ticketPriceScadBase();
    const priceLamports = scadBaseToLamports(priceScad);

    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('Account banned');

    // Debit + create the ticket atomically. The conditional debit enforces
    // funds and closes the double-spend race.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const replay = await claimIdempotency(tx, params.userId, 'lottery_buy', key);
      if (replay) {
        return { response: replay as ReturnType<typeof this.serializeTicket>, replayed: true };
      }

      await applyBalanceDelta(tx, params.userId, -priceLamports, {
        reason: 'lottery_ticket',
        refType: 'LotteryDraw',
        refId: open.id,
      });
      const ticket = await tx.lotteryTicket.create({
        data: {
          drawId: open.id,
          userId: params.userId,
          digits: params.digits,
          costLamports: priceLamports,
          costScadBase: priceScad,
        },
      });

      // #215 — close the late-buy orphan window (see jackpot.service for the full
      // argument). getOpenDraw() above is pre-tx and races the settle: a draw can
      // claim the draw terminal between that check and this commit, orphaning the
      // debit + ticket (no Bet, no payout, no refund). A guarded no-op write on
      // the draw row makes the whole tx CONDITIONAL on the draw still being 'open'
      // at commit — it row-locks the same draw row the settle's claim updateMany
      // flips (open→drawn), so they serialize: a claimed draw rejects this buy and
      // rolls back the debit; a buy that commits first is read by the settle
      // INSIDE its serializable tx after the claim and is settled.
      await this.assertDrawStillOpen(tx, open.id);

      const response = this.serializeTicket(ticket);
      await storeIdempotency(tx, params.userId, 'lottery_buy', key, response);
      return { response, replayed: false };
    });

    if (!outcome.replayed) await this.engine.onTicketSold(priceScad, priceLamports, 1);

    return outcome.response;
  }

  /**
   * #215 — re-assert (inside the buy tx) that the draw is still open at commit,
   * via a guarded no-op write on the draw row. Returns nothing; throws (rolling
   * the WHOLE tx back, including the debit) if the draw was already claimed
   * terminal by the settle. The updateMany row-locks the draw row the settle's
   * claim flips, so a late buy is EITHER included by the settle's
   * inside-the-tx ticket read OR fully rejected — never an orphaned debit.
   */
  private async assertDrawStillOpen(tx: Prisma.TransactionClient, drawId: string) {
    const { count } = await tx.lotteryDraw.updateMany({
      where: { id: drawId, status: 'open' },
      data: { status: 'open' },
    });
    if (count === 0) {
      throw new BadRequestException('Draw just closed — your ticket was not bought');
    }
  }

  private serializeTicket(ticket: {
    id: string;
    drawId: string;
    digits: number[];
    costScadBase: bigint;
    costLamports: bigint;
  }) {
    return {
      id: ticket.id,
      drawId: ticket.drawId,
      digits: ticket.digits,
      costScadBase: ticket.costScadBase.toString(),
      costLamports: ticket.costLamports.toString(),
    };
  }

  /**
   * "Game number": the draw's wall-clock time (UTC+3, same zone as the draw
   * schedule) formatted as YYYYMMDDHHMMSS. Computed server-side — the web
   * bundle can't import runtime values from @scadium/shared.
   */
  private gameNumber(drawAt: Date): string {
    const local = new Date(drawAt.getTime() + LOTTERY.DRAW_TZ_OFFSET_MINUTES * 60_000);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return (
      `${local.getUTCFullYear()}${p(local.getUTCMonth() + 1)}${p(local.getUTCDate())}` +
      `${p(local.getUTCHours())}${p(local.getUTCMinutes())}${p(local.getUTCSeconds())}`
    );
  }

  private scad(base: bigint): number {
    return Number(base) / SCAD_BASE;
  }

  async myTickets(userId: string, limit = 20, wonOnly = false) {
    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { userId, ...(wonOnly ? { won: true } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { draw: true },
    });
    return tickets.map((t) => ({
      id: t.id,
      drawId: t.drawId,
      gameNumber: this.gameNumber(t.draw.drawAt),
      digits: t.digits,
      costScad: this.scad(t.costScadBase),
      matchLen: t.matchLen,
      bracket: t.bracket,
      payoutScad: this.scad(t.payoutScadBase),
      free: t.free,
      txSignature: t.txSignature,
      prizeTxSignature: t.prizeTxSignature,
      won: t.won,
      drawStatus: t.draw.status,
      drawDigits: t.draw.winningDigits,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  /** Per-user lifetime lottery stats for the My Bets header cards. */
  async myStats(userId: string) {
    const [totalTickets, winningTickets, prizeSum] = await Promise.all([
      this.prisma.lotteryTicket.count({ where: { userId } }),
      this.prisma.lotteryTicket.count({ where: { userId, won: true } }),
      this.prisma.lotteryTicket.aggregate({
        where: { userId },
        _sum: { payoutScadBase: true },
      }),
    ]);
    return {
      totalTickets,
      winningTickets,
      totalPrizeScad: this.scad(prizeSum._sum.payoutScadBase ?? BigInt(0)),
    };
  }

  /**
   * Results tab: one round's winning number, sale/winner tallies and the public
   * winners list (player display follows the leaderboard precedent: username or
   * truncated wallet). Public endpoint — the server seed is only exposed once
   * the draw has been revealed.
   */
  async drawResults(drawIndex: bigint, winnersLimit = 50) {
    const draw = await this.prisma.lotteryDraw.findUnique({
      where: { drawIndex },
      include: { seed: true },
    });
    if (!draw) throw new NotFoundException('Draw not found');

    const drawn = draw.status === 'drawn';
    const [winnersCount, winners] = await Promise.all([
      this.prisma.lotteryTicket.count({ where: { drawId: draw.id, won: true } }),
      this.prisma.lotteryTicket.findMany({
        where: { drawId: draw.id, won: true },
        orderBy: { payoutScadBase: 'desc' },
        take: winnersLimit,
        include: {
          user: { select: { username: true, walletAddress: true, avatarUrl: true } },
        },
      }),
    ]);

    return {
      drawId: draw.id,
      drawIndex: draw.drawIndex?.toString() ?? null,
      gameNumber: this.gameNumber(draw.drawAt),
      status: draw.status,
      drawAt: draw.drawAt.toISOString(),
      drawnAt: draw.drawnAt?.toISOString() ?? null,
      digits: draw.winningDigits,
      ticketCount: draw.ticketCount,
      totalPoolScad: this.scad(draw.totalPoolScadBase),
      burnScad: this.scad(draw.burnScadBase),
      bracketWinnerCounts: draw.bracketWinnerCounts,
      bracketAmountsScad: draw.bracketAmountsScadBase.map((a) => this.scad(a)),
      commitTxSignature: draw.commitTxSignature,
      revealTxSignature: draw.revealTxSignature,
      serverSeed: drawn ? draw.seed.serverSeed : null,
      serverSeedHash: draw.seed.serverSeedHash,
      clientSeed: draw.seed.clientSeed,
      nonce: draw.nonce,
      slotHash: draw.slotHash,
      winnersCount,
      winners: winners.map((t) => ({
        player: {
          username: t.user.username,
          walletAddress: t.user.walletAddress,
          avatarUrl: t.user.avatarUrl,
        },
        digits: t.digits,
        matchLen: t.matchLen,
        bracket: t.bracket,
        payoutScad: this.scad(t.payoutScadBase),
      })),
    };
  }

  /** Jackpot Winners tab: historical jackpot (bracket 5, all-6-match) winners. */
  async jackpotWinners(limit = 50) {
    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { bracket: LOTTERY.BRACKET_COUNT - 1 },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { username: true, walletAddress: true, avatarUrl: true } },
        draw: true,
      },
    });
    return tickets.map((t) => ({
      drawIndex: t.draw.drawIndex?.toString() ?? null,
      gameNumber: this.gameNumber(t.draw.drawAt),
      drawnAt: t.draw.drawnAt?.toISOString() ?? null,
      player: {
        username: t.user.username,
        walletAddress: t.user.walletAddress,
        avatarUrl: t.user.avatarUrl,
      },
      digits: t.digits,
      matchLen: t.matchLen,
      bracket: t.bracket,
      payoutScad: this.scad(t.payoutScadBase),
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
      gameNumber: this.gameNumber(d.drawAt),
      commitTxSignature: d.commitTxSignature,
      revealTxSignature: d.revealTxSignature,
      digits: d.winningDigits,
      ticketCount: d.ticketCount,
      totalPoolScad: this.scad(d.totalPoolScadBase),
      drawnAt: d.drawnAt?.toISOString() ?? null,
      serverSeed: d.seed.serverSeed,
      serverSeedHash: d.seed.serverSeedHash,
      clientSeed: d.seed.clientSeed,
      nonce: d.nonce,
      slotHash: d.slotHash,
    }));
  }
}
