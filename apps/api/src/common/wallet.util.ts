import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Single source of truth for debiting the play-money balance.
 *
 * The debit is a single guarded `updateMany` (`playBalanceLamports >= amount`),
 * NOT a read-then-decrement. A conditional UPDATE takes a row lock, so two
 * concurrent debits can never both succeed: the second one re-evaluates the
 * `gte` predicate against the already-decremented balance, matches zero rows,
 * and is rejected. This closes the double-spend race regardless of the
 * (default READ COMMITTED) isolation level, and the DB `CHECK
 * (playBalanceLamports >= 0)` constraint is the last-line backstop. Pass the
 * transaction client when the debit must compose atomically with other writes
 * (e.g. ledger/settlement rows); the base PrismaClient works for a lone debit.
 */
export async function debitPlayBalance(
  client: Prisma.TransactionClient,
  userId: string,
  amount: bigint,
): Promise<void> {
  const { count } = await client.user.updateMany({
    where: { id: userId, banned: false, playBalanceLamports: { gte: amount } },
    data: { playBalanceLamports: { decrement: amount } },
  });
  if (count === 0) throw new BadRequestException('Insufficient balance');
}
