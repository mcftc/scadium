import { BadRequestException } from '@nestjs/common';
import { Prisma, type PrismaClient, type Currency } from '@prisma/client';
import type { PrismaService } from './prisma.service';

// Maps each currency to its denormalized balance column on `User`. Keeps the
// balances strictly separated: `jeton` (bought, non-redeemable wagering balance)
// vs `scad` (earned, redeemable reward balance) vs the SCAD Engine balances —
// `scad_staked` (locked, dividend-earning) and `usds` (USD-pegged dividend payout).
const BALANCE_COLUMN = {
  jeton: 'playBalanceLamports',
  scad: 'scadiumBalance',
  scad_staked: 'scadiumStaked',
  usds: 'usdsBalance',
} as const satisfies Record<
  Currency,
  'playBalanceLamports' | 'scadiumBalance' | 'scadiumStaked' | 'usdsBalance'
>;

/**
 * Single mutation point for `User.playBalanceLamports`. EVERY play-balance
 * movement (credit or debit) must go through this helper so an append-only
 * `BalanceLedger` row is written in the SAME transaction as the balance change.
 * That makes the live balance a re-derivable projection: each row's
 * `balanceAfter` is the live balance immediately after that movement, so the
 * latest row's `balanceAfter` equals `User.playBalanceLamports` for an
 * untampered user. (`SUM(delta)` reconstructs the balance NET of the opening
 * balance — new users start at a 10 SOL default that is not ledgered, so
 * reconciliation compares against the latest `balanceAfter`, not `SUM(delta)`.)
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
  meta: {
    reason: string;
    refType: string;
    refId?: string | null;
    /** Which balance to move. Defaults to `jeton` (playBalanceLamports). */
    currency?: Currency;
    /**
     * Upper bound enforced on CREDITS only (delta > 0). When set, the credit is
     * applied via a guarded `updateMany` that matches only if the resulting
     * balance would stay `<= maxBalance`, so the $100 Jeton holding cap is
     * concurrency-safe (same row-lock argument as the atomic-debit guard) and
     * never a read-then-write race. Ignored for debits.
     */
    maxBalance?: bigint;
  },
): Promise<bigint> {
  const currency: Currency = meta.currency ?? 'jeton';
  const column = BALANCE_COLUMN[currency];

  if (delta < 0n) {
    const { count } = await tx.user.updateMany({
      where: { id: userId, banned: false, [column]: { gte: -delta } },
      data: { [column]: { increment: delta } },
    });
    if (count === 0) throw new BadRequestException('Insufficient balance');
  } else if (delta > 0n) {
    if (meta.maxBalance !== undefined) {
      // Credit only if the resulting balance stays within the cap. A row lock on
      // the guarded updateMany serializes concurrent credits, so two in-flight
      // top-ups can never both push the balance over the cap.
      const { count } = await tx.user.updateMany({
        where: { id: userId, [column]: { lte: meta.maxBalance - delta } },
        data: { [column]: { increment: delta } },
      });
      if (count === 0) {
        throw new BadRequestException(`${currency} balance cap reached`);
      }
    } else {
      // Throws P2025 if the user does not exist → the transaction rolls back.
      await tx.user.update({
        where: { id: userId },
        data: { [column]: { increment: delta } },
      });
    }
  }
  // delta === 0n: no balance change, but we still record a ledger row below so
  // the audit trail is complete (rare; e.g. a zero-value refund/no-op).

  // Same-tx read sees the write above. The computed `select` key widens Prisma's
  // inferred type to a union, so narrow it back through a typed record.
  const user = (await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { [column]: true } as Prisma.UserSelect,
  })) as unknown as Record<string, bigint>;
  const balanceAfter = user[column];

  await tx.balanceLedger.create({
    data: {
      userId,
      currency,
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
