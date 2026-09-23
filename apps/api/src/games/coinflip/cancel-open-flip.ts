import type { Prisma } from '@prisma/client';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';

/**
 * Cancel an open flip and refund its creator — the one place this happens, for
 * all three callers: the creator's cancel, the expiry sweep, and a
 * self-exclusion or cooling-off (whose open flips must not stay joinable).
 *
 * The status flip is a compare-and-swap on `status = 'open'`, so a cancel
 * racing a join can never BOTH refund the creator and let the flip resolve
 * (Phase-0 H2): exactly one of them claims the row. Returns false when the flip
 * was no longer open — nothing was refunded.
 */
export async function cancelOpenFlip(
  tx: Prisma.TransactionClient,
  gameId: string,
): Promise<boolean> {
  const claimed = await tx.coinflipGame.updateMany({
    where: { id: gameId, status: 'open' },
    data: { status: 'cancelled', resolvedAt: new Date() },
  });
  if (claimed.count === 0) return false;
  const game = await tx.coinflipGame.findUniqueOrThrow({
    where: { id: gameId },
    select: { creatorId: true, amountLamports: true },
  });
  await applyBalanceDelta(tx, game.creatorId, game.amountLamports, {
    reason: 'refund',
    refType: 'CoinflipGame',
    refId: gameId,
  });
  return true;
}
