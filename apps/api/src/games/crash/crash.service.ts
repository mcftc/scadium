import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CRASH } from '@scadium/shared';
import { CrashEngine } from './crash.engine';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';
import { withSerializable } from '../../prisma/with-serializable';
import { claimIdempotency, storeIdempotency } from '../../prisma/idempotency';

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

  async placeBet(
    params: {
      userId: string;
      amountLamports: bigint;
      autoCashout: number | null;
    },
    key?: string,
  ) {
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

    // The waiting round exists before the bet — capture its id so we can persist
    // a durable CrashBet row in the SAME tx as the debit (#14: a restart can
    // then refund stranded stakes). ensureRoundPersisted re-asserts the round
    // row exists (no-op in prod) so the CrashBet FK can never fail.
    const roundId = this.engine.currentRoundId();
    await this.engine.ensureRoundPersisted();

    // Crash is NOT single-tx (debit, then in-memory engine, then refund-on-throw).
    // Claim the key INSIDE the debit's serializable tx so key+debit are atomic.
    // A replay short-circuits WITHOUT debiting or touching the engine.
    const claim = await withSerializable(this.prisma, async (tx) => {
      const replay = await claimIdempotency(tx, params.userId, 'crash_bet', key);
      if (replay) return { replay: replay as { ok: true; roundId: string } };
      await applyBalanceDelta(tx, params.userId, -params.amountLamports, {
        reason: 'crash_bet',
        refType: 'CrashRound',
        refId: roundId,
      });
      // Durable bet row: remaining == stake until a cashout shrinks it. The
      // engine.placeBet below still rejects (and we roll back) if the window
      // closed between roundId capture and now. skipDuplicates so a racing
      // double-bet's unique (roundId,userId) collision cannot abort the tx with
      // a raw 23505 (the guarded debit above is the real one-bet guarantee).
      await tx.crashBet.createMany({
        data: [
          {
            roundId,
            userId: params.userId,
            amountLamports: params.amountLamports,
            remainingLamports: params.amountLamports,
            autoCashoutMultiplier: params.autoCashout,
            payoutLamports: BigInt(0),
            won: false,
          },
        ],
        skipDuplicates: true,
      });
      return { replay: null };
    });
    if (claim.replay) return claim.replay;

    let response: { ok: true; roundId: string };
    try {
      response = this.engine.placeBet({
        userId: params.userId,
        username: user.username,
        walletAddress: user.walletAddress,
        amountLamports: params.amountLamports,
        autoCashout: params.autoCashout,
      });
    } catch (e) {
      // Roll back the debit on engine rejection — a separate atomic movement
      // (its own ledger row), which is correct double-entry. The CrashBet row
      // committed alongside the debit, so delete it here too.
      await withSerializable(this.prisma, (tx) =>
        applyBalanceDelta(tx, params.userId, params.amountLamports, {
          reason: 'refund',
          refType: 'CrashRound',
          refId: roundId,
        }),
      );
      await this.prisma.crashBet
        .deleteMany({ where: { roundId, userId: params.userId } })
        .catch(() => undefined);
      // Also drop the key (best-effort) so a failed bet's key doesn't 409
      // forever — the client can retry with the same key.
      if (key) {
        await this.prisma.idempotencyKey
          .deleteMany({ where: { userId: params.userId, scope: 'crash_bet', clientKey: key } })
          .catch(() => undefined);
      }
      throw new BadRequestException(e instanceof Error ? e.message : 'Bet rejected');
    }

    // Persist the response for replay (response is JSON-safe: roundId is a
    // string, ok is a boolean — no BigInt). A single update needs no tx.
    if (key) {
      await storeIdempotency(
        this.prisma as unknown as Prisma.TransactionClient,
        params.userId,
        'crash_bet',
        key,
        response,
      );
    }
    return response;
  }

  async cashOut(userId: string, percent = 100) {
    try {
      return await this.engine.cashOut(userId, percent);
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
