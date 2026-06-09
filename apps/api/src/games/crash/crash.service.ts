import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CRASH } from '@scadium/shared';
import { CrashEngine } from './crash.engine';
import { debitPlayBalance } from '../../common/wallet.util';

/**
 * Thin facade that adapts HTTP DTOs to the in-memory CrashEngine.
 * Balance deduction happens here (pessimistic debit at bet time) so a
 * disconnecting player can't dodge the loss.
 */
@Injectable()
export class CrashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: CrashEngine,
  ) {}

  snapshot() {
    return this.engine.snapshot();
  }

  async placeBet(params: {
    userId: string;
    amountLamports: bigint;
    autoCashout: number | null;
  }) {
    if (
      params.amountLamports < BigInt(CRASH.MIN_BET_LAMPORTS) ||
      params.amountLamports > BigInt(CRASH.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('Bet out of range');
    }
    if (
      params.autoCashout !== null &&
      (params.autoCashout < CRASH.MIN_CASHOUT_MULTIPLIER ||
        params.autoCashout > CRASH.MAX_CASHOUT_MULTIPLIER)
    ) {
      throw new BadRequestException('Auto-cashout out of range');
    }

    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('Account banned');

    // Atomic conditional debit — closes the double-spend race. A lone guarded
    // updateMany is itself atomic, so no surrounding $transaction is needed.
    await debitPlayBalance(this.prisma, params.userId, params.amountLamports);

    try {
      return this.engine.placeBet({
        userId: params.userId,
        username: user.username,
        walletAddress: user.walletAddress,
        amountLamports: params.amountLamports,
        autoCashout: params.autoCashout,
      });
    } catch (e) {
      // Roll back the debit on engine rejection
      await this.prisma.user.update({
        where: { id: params.userId },
        data: { playBalanceLamports: { increment: params.amountLamports } },
      });
      throw new BadRequestException(e instanceof Error ? e.message : 'Bet rejected');
    }
  }

  cashOut(userId: string, percent = 100) {
    try {
      return this.engine.cashOut(userId, percent);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Cashout rejected');
    }
  }

  /**
   * "Schedule Bet For Next Round": same validation + pessimistic debit as
   * placeBet, but the stake parks in the engine's next-round queue. Refunded
   * in full if the player cancels before the round opens.
   */
  async scheduleBet(params: {
    userId: string;
    amountLamports: bigint;
    autoCashout: number | null;
  }) {
    if (
      params.amountLamports < BigInt(CRASH.MIN_BET_LAMPORTS) ||
      params.amountLamports > BigInt(CRASH.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('Bet out of range');
    }
    if (
      params.autoCashout !== null &&
      (params.autoCashout < CRASH.MIN_CASHOUT_MULTIPLIER ||
        params.autoCashout > CRASH.MAX_CASHOUT_MULTIPLIER)
    ) {
      throw new BadRequestException('Auto-cashout out of range');
    }

    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('Account banned');

    // Atomic conditional debit — see placeBet.
    await debitPlayBalance(this.prisma, params.userId, params.amountLamports);

    try {
      this.engine.scheduleBet({
        userId: params.userId,
        username: user.username,
        walletAddress: user.walletAddress,
        amountLamports: params.amountLamports,
        autoCashout: params.autoCashout,
      });
      return { ok: true as const, scheduled: true as const };
    } catch (e) {
      await this.prisma.user.update({
        where: { id: params.userId },
        data: { playBalanceLamports: { increment: params.amountLamports } },
      });
      throw new BadRequestException(e instanceof Error ? e.message : 'Schedule rejected');
    }
  }

  /** Cancel the queued next-round bet and refund its stake. */
  async cancelScheduled(userId: string) {
    let amount: bigint;
    try {
      ({ amountLamports: amount } = this.engine.cancelScheduled(userId));
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Nothing to cancel');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { playBalanceLamports: { increment: amount } },
    });
    return { ok: true as const, refundedLamports: amount.toString() };
  }
}
