import { BadRequestException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { PrismaService } from './prisma.service';

/**
 * Single mutation point for `User.playBalanceLamports`. EVERY play-balance
 * movement (credit or debit) must go through this helper so an append-only
 * `BalanceLedger` row is written in the SAME transaction as the balance change.
 * That makes the live balance a re-derivable projection: `SUM(delta)` per user
 * always equals `User.playBalanceLamports`, and each row's `balanceAfter` is the
 * running sum at the time it was written.
 *
 * MUST be called on a transaction client (`tx`) so the balance mutation and the
 * ledger row commit (or roll back) atomically. A rolled-back settlement leaves
 * no ledger rows.
 *
 * Sign convention: `delta < 0` debits, `delta > 0` credits.
 *
 * Debits preserve the #5 atomic-debit guarantee: a single guarded `updateMany`
 * (`banned: false`, `playBalanceLamports >= -delta`) takes a row lock, so two
 * concurrent debits can never both succeed — the second re-evaluates the `gte`
 * predicate against the already-decremented balance, matches zero rows, and is
 * rejected with `BadRequestException('Insufficient balance')`.
 */
export async function applyBalanceDelta(
  tx: Prisma.TransactionClient,
  userId: string,
  delta: bigint,
  meta: { reason: string; refType: string; refId?: string | null },
): Promise<bigint> {
  if (delta < 0n) {
    const { count } = await tx.user.updateMany({
      where: { id: userId, banned: false, playBalanceLamports: { gte: -delta } },
      data: { playBalanceLamports: { increment: delta } },
    });
    if (count === 0) throw new BadRequestException('Insufficient balance');
  } else if (delta > 0n) {
    // Throws P2025 if the user does not exist → the transaction rolls back.
    await tx.user.update({
      where: { id: userId },
      data: { playBalanceLamports: { increment: delta } },
    });
  }
  // delta === 0n: no balance change, but we still record a ledger row below so
  // the audit trail is complete (rare; e.g. a zero-value refund/no-op).

  // Same-tx read sees the write above.
  const { playBalanceLamports: balanceAfter } = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { playBalanceLamports: true },
  });

  await tx.balanceLedger.create({
    data: {
      userId,
      delta,
      reason: meta.reason,
      refType: meta.refType,
      refId: meta.refId ?? null,
      balanceAfter,
    },
  });

  return balanceAfter;
}

/**
 * Re-derive a user's balance from the append-only ledger: `SUM(delta)`. Returns
 * 0n when the user has no ledger rows. Used by the future reconciliation task to
 * assert the projection (`User.playBalanceLamports`) matches the ledger.
 */
export async function deriveBalance(
  prisma: PrismaService | PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<bigint> {
  const { _sum } = await prisma.balanceLedger.aggregate({
    _sum: { delta: true },
    where: { userId },
  });
  return _sum.delta ?? 0n;
}
