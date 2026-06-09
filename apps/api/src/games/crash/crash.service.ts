import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CRASH } from '@scadium/shared';
import { CrashEngine } from './crash.engine';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { withSerializable } from '../../prisma/with-serializable';

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

    // Atomic conditional debit — closes the double-spend race. Wrapped in a tx
    // so the debit and its ledger row commit together.
    await withSerializable(this.prisma, (tx) =>
      applyBalanceDelta(tx, params.userId, -params.amountLamports, {
        reason: 'crash_bet',
        refType: 'CrashRound',
        refId: null,
      }),
    );

    try {
      return this.engine.placeBet({
        userId: params.userId,
        username: user.username,
        walletAddress: user.walletAddress,
        amountLamports: params.amountLamports,
        autoCashout: params.autoCashout,
      });
    } catch (e) {
      // Roll back the debit on engine rejection — a separate atomic movement
      // (its own ledger row), which is correct double-entry.
      await withSerializable(this.prisma, (tx) =>
        applyBalanceDelta(tx, params.userId, params.amountLamports, {
          reason: 'refund',
          refType: 'CrashRound',
          refId: null,
        }),
      );
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
    await withSerializable(this.prisma, (tx) =>
      applyBalanceDelta(tx, params.userId, -params.amountLamports, {
        reason: 'crash_bet',
        refType: 'CrashRound',
        refId: null,
      }),
    );

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
      await withSerializable(this.prisma, (tx) =>
        applyBalanceDelta(tx, params.userId, params.amountLamports, {
          reason: 'refund',
          refType: 'CrashRound',
          refId: null,
        }),
      );
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
    await withSerializable(this.prisma, (tx) =>
      applyBalanceDelta(tx, userId, amount, {
        reason: 'refund',
        refType: 'CrashRound',
        refId: null,
      }),
    );
    return { ok: true as const, refundedLamports: amount.toString() };
  }
}
