import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BLACKJACK } from '@scadium/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BlackjackEngine } from './blackjack.engine';
import { debitPlayBalance } from '../../common/wallet.util';

/**
 * HTTP facade for the multiplayer blackjack tables. All balance movement
 * happens HERE (pessimistic debit before the engine accepts a bet, refunds
 * on clear/leave/rejection) so a disconnecting player can never dodge a
 * stake — the engine itself only manages table state.
 */
@Injectable()
export class BlackjackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: BlackjackEngine,
  ) {}

  listTables() {
    return this.engine.listTables();
  }

  /** Seated players across public tables (platform live counters). */
  activeCount(): number {
    return this.engine.seatedCount();
  }

  snapshot(tableId: string) {
    try {
      return this.engine.snapshot(tableId);
    } catch (e) {
      throw new NotFoundException(e instanceof Error ? e.message : 'Table not found');
    }
  }

  findLobby() {
    return this.engine.findLobby();
  }

  soloTable(userId: string) {
    return this.engine.soloTable(userId);
  }

  async takeSeat(params: { tableId: string; seatIndex: number; userId: string }) {
    const user = await this.loadUser(params.userId);
    try {
      return this.engine.takeSeat({
        tableId: params.tableId,
        seatIndex: params.seatIndex,
        userId: user.id,
        username: user.username,
        walletAddress: user.walletAddress,
      });
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Seat rejected');
    }
  }

  async leaveSeat(tableId: string, userId: string) {
    let refund: bigint;
    try {
      ({ refundLamports: refund } = this.engine.leaveSeat(tableId, userId));
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Leave rejected');
    }
    if (refund > BigInt(0)) await this.credit(userId, refund);
    return { ok: true as const, refundedLamports: refund.toString() };
  }

  async placeBet(params: {
    tableId: string;
    userId: string;
    mainLamports: bigint;
    side21p3Lamports: bigint;
    sidePerfectPairsLamports: bigint;
  }) {
    const { mainLamports, side21p3Lamports, sidePerfectPairsLamports } = params;
    if (
      mainLamports < BigInt(BLACKJACK.MIN_BET_LAMPORTS) ||
      mainLamports > BigInt(BLACKJACK.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('Main bet out of range');
    }
    if (side21p3Lamports < BigInt(0) || sidePerfectPairsLamports < BigInt(0)) {
      throw new BadRequestException('Side bets cannot be negative');
    }
    if (
      side21p3Lamports > BigInt(BLACKJACK.MAX_BET_LAMPORTS) ||
      sidePerfectPairsLamports > BigInt(BLACKJACK.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('Side bet out of range');
    }
    const total = mainLamports + side21p3Lamports + sidePerfectPairsLamports;

    // loadUser enforces banned/exists; the conditional debit enforces funds.
    await this.loadUser(params.userId);
    await this.debit(params.userId, total);
    try {
      const { previousTotalLamports } = this.engine.placeBet({
        tableId: params.tableId,
        userId: params.userId,
        bet: { mainLamports, side21p3Lamports, sidePerfectPairsLamports },
      });
      // Replacing an earlier bet within the same window refunds the old stake.
      if (previousTotalLamports > BigInt(0)) await this.credit(params.userId, previousTotalLamports);
      return { ok: true as const };
    } catch (e) {
      await this.credit(params.userId, total);
      throw new BadRequestException(e instanceof Error ? e.message : 'Bet rejected');
    }
  }

  async clearBet(tableId: string, userId: string) {
    let refund: bigint;
    try {
      ({ refundLamports: refund } = this.engine.clearBet(tableId, userId));
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Clear rejected');
    }
    await this.credit(userId, refund);
    return { ok: true as const, refundedLamports: refund.toString() };
  }

  async action(params: { tableId: string; userId: string; action: 'hit' | 'stand' | 'double' }) {
    // Double doubles the MAIN stake — debit the extra before the engine
    // mutates the hand, refund if it rejects.
    let extra = BigInt(0);
    if (params.action === 'double') {
      const snap = this.engine.snapshot(params.tableId);
      const seat = snap.seats.find((s) => s.userId === params.userId);
      if (!seat?.bet) throw new BadRequestException('No active bet');
      extra = BigInt(seat.bet.mainLamports);
      await this.loadUser(params.userId);
      // Conditional debit rejects with 'Insufficient balance' if underfunded.
      await this.debit(params.userId, extra);
    }
    try {
      return this.engine.action(params);
    } catch (e) {
      if (extra > BigInt(0)) await this.credit(params.userId, extra);
      throw new BadRequestException(e instanceof Error ? e.message : 'Action rejected');
    }
  }

  // ---------- helpers ----------

  private async loadUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('Account banned');
    return user;
  }

  private debit(userId: string, amount: bigint) {
    // Atomic conditional debit (guarded updateMany) — closes the double-spend
    // race that plain decrement allowed between concurrent bets.
    return debitPlayBalance(this.prisma, userId, amount);
  }

  private credit(userId: string, amount: bigint) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { playBalanceLamports: { increment: amount } },
    });
  }
}
