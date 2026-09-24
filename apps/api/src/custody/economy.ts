import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { custodyConfig } from './custody.config';

type Db = Prisma.TransactionClient;

/** A pooled game — one shared pot per round, so its entries must all be real money. */
export type PooledGame = 'jackpot' | 'lottery';

/**
 * Play-money vs real money (ADR 0005, spec §7). One balance column holds both:
 * an account is `real` once a custody deposit has been credited (`fundedAt`),
 * `play` before. Free play-money must never become withdrawable, so every path
 * that moves value BETWEEN players, or carries play-era value across the first
 * deposit, asks these rules. They apply only while custody is enabled; without
 * it there is nothing to withdraw and every check passes.
 *
 * Every check takes the caller's transaction, so it is decided on the same
 * snapshot as the money it guards. Plain functions: the rules hold no state,
 * only the setting and the caller's transaction.
 */
export function economyEnforced(): boolean {
  return custodyConfig().enabled;
}

async function isReal(db: Db, userId: string): Promise<boolean> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { fundedAt: true } });
  return u.fundedAt !== null;
}

/**
 * `isReal` holding the user's row lock until the caller's transaction ends —
 * for callers not running Serializable, so a first deposit committing between
 * this read and the caller's debit cannot switch the stake's economy under it.
 */
async function isRealLocked(db: Db, userId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ funded: boolean }[]>`
    SELECT "fundedAt" IS NOT NULL AS funded FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  return rows[0]?.funded ?? false;
}

/**
 * E1 — a game that takes deposited SOL only while custody is on:
 *  - jackpot and lottery pay one pot shared by the round, so play money in it
 *    would be paid out to deposited winners;
 *  - blackjack keeps a seat's stake only in memory between the debit and the
 *    round's saved state, where a first deposit's open-position check (E6)
 *    cannot see it — so play accounts do not play it at all.
 */
export async function assertDepositedOnly(db: Db, userId: string, game: string): Promise<void> {
  if (!economyEnforced()) return;
  if (!(await isReal(db, userId))) {
    throw new ForbiddenException(`Deposit SOL to play ${game} — it is played with deposited funds only`);
  }
}

/**
 * E1 for the pooled games: deposited funds only, and not into a round that
 * still holds play entries made before custody was switched on.
 */
export async function assertPooledEntry(
  db: Db,
  userId: string,
  game: PooledGame,
  roundId: string,
): Promise<void> {
  if (!economyEnforced()) return;
  await assertDepositedOnly(db, userId, game);
  const playEntry =
    game === 'jackpot'
      ? await db.jackpotEntry.findFirst({
          where: { roundId, user: { fundedAt: null } },
          select: { id: true },
        })
      : await db.lotteryTicket.findFirst({
          where: { drawId: roundId, user: { fundedAt: null } },
          select: { id: true },
        });
  if (playEntry) {
    throw new ForbiddenException(
      `This ${game === 'jackpot' ? 'round' : 'draw'} still holds play-money entries — join the next one`,
    );
  }
}

/**
 * E2 — a PvP coinflip is joinable only from the creator's economy. The joiner's
 * row is locked (the join tx is not Serializable); the creator needs no lock —
 * their open flip is an open position, so they cannot convert while it is open.
 */
export async function assertSameEconomy(db: Db, creatorId: string, joinerId: string): Promise<void> {
  if (!economyEnforced()) return;
  if ((await isReal(db, creatorId)) !== (await isRealLocked(db, joinerId))) {
    throw new ForbiddenException(
      'This flip is played with the other balance type (play-money vs deposited SOL)',
    );
  }
}

/** E3 — the airdrop pool is a play-money promotion: only play accounts tip. */
export async function assertPlayOnly(db: Db, userId: string, what: string): Promise<void> {
  if (!economyEnforced()) return;
  if (await isReal(db, userId)) throw new ForbiddenException(`${what} is a play-money feature`);
}

/**
 * E3/E4 — who may receive a play-money promotion (airdrop share, race prize).
 * A Prisma user filter for ranking/eligibility; undefined = everyone. The
 * payout itself re-checks with `stillPlay` inside its own transaction.
 */
export function promotionRecipients(): Prisma.UserWhereInput | undefined {
  return economyEnforced() ? { fundedAt: null } : undefined;
}

/**
 * Of `userIds`, those still play accounts — read under their row locks inside
 * the crediting transaction, so a first deposit cannot convert one between the
 * eligibility check and the credit (it waits for this transaction, then
 * forfeits the credited play money with the rest). Everyone when custody is off.
 */
export async function stillPlay(db: Db, userIds: string[]): Promise<Set<string>> {
  if (!economyEnforced() || userIds.length === 0) return new Set(userIds);
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id"::text AS id FROM "User"
    WHERE "id" = ANY(${userIds}::uuid[]) AND "fundedAt" IS NULL
    ORDER BY "id" FOR UPDATE`;
  return new Set(rows.map((r) => r.id));
}

/**
 * E5 — referral commission accrues only between accounts of the same economy.
 * The referrer's row is locked: some settles are not Serializable, and a first
 * deposit committing mid-settle must not receive play-era commission.
 */
export async function sharesEconomy(db: Db, referrerId: string, refereeId: string): Promise<boolean> {
  if (!economyEnforced()) return true;
  return (await isRealLocked(db, referrerId)) === (await isReal(db, refereeId));
}

/**
 * E6 — stakes a user still has riding on play-money (debited, not yet
 * settled). A first deposit waits until there are none, or their payouts would
 * land in the now-real balance. Returns labels, for logs and the UI.
 */
export async function openPlayPositions(db: Db, userId: string): Promise<string[]> {
  // Sequential on purpose: these run inside the caller's interactive transaction.
  const open: string[] = [];
  const crash =
    (await db.crashBet.count({
      where: { userId, round: { status: { in: ['waiting', 'running'] } } },
    })) + (await db.scheduledCrashBet.count({ where: { userId } }));
  if (crash > 0) open.push('crash');
  const flips = await db.coinflipGame.count({
    where: {
      status: { in: ['open', 'matched', 'resolving'] },
      OR: [{ creatorId: userId }, { joinerId: userId }],
    },
  });
  if (flips > 0) open.push('coinflip');
  if ((await db.jackpotEntry.count({ where: { userId, round: { status: 'open' } } })) > 0) {
    open.push('jackpot');
  }
  if ((await db.lotteryTicket.count({ where: { userId, draw: { status: 'open' } } })) > 0) {
    open.push('lottery');
  }
  if ((await db.instantRound.count({ where: { userId, status: 'active' } })) > 0) {
    open.push('instant');
  }
  // Blackjack keeps its seats in the round's JSON state; a user id appearing in
  // an unfinished round's state means a seat is still in play.
  const blackjack = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "BlackjackRound"
    WHERE "endedAt" IS NULL AND "stateJson"::text LIKE ${`%${userId}%`}`;
  if ((blackjack[0]?.n ?? 0n) > 0n) open.push('blackjack');
  return open;
}
