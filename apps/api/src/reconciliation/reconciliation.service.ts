import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Phase G reconciliation job (drift detection — FLAG ONLY, never mutates).
 *
 * Once an hour it recomputes, per user, the five denormalized `User` aggregate
 * columns from the unified `Bet` history and the user's derived play balance
 * from the append-only `BalanceLedger`, then compares each against the live
 * `User` row. For every field that disagrees it appends one `ReconciliationDrift`
 * row. It NEVER writes back to `User` — a human/Phase-H worker investigates and
 * repairs. This catches integrity bugs like the known `biggestWin` understatement
 * (only the coinflip path updated it) without risking auto-corrupting balances.
 *
 * Drift rules:
 *  - Aggregates (`totalWagered`, `totalWon`, `totalLost`, `biggestWin`,
 *    `gamesPlayed`): recomputed from `Bet` for EVERY user (a user with no bets
 *    derives all-zero). A user with zero bets but a non-zero stored aggregate is
 *    a real mismatch and is flagged; an all-zero/all-match user is not.
 *  - `playBalanceLamports` vs the latest BalanceLedger row's `balanceAfter`:
 *    compared ONLY for users who have at least one BalanceLedger row. New users
 *    are funded with a 10 SOL default that is NOT ledgered, so comparing against
 *    SUM(delta) would under-report by the opening balance and false-positive the
 *    whole user base. Instead we compare against the most recent `balanceAfter`,
 *    which `applyBalanceDelta` stamps as the live balance after each movement —
 *    so an untampered user always matches, and a direct (non-ledgered) write to
 *    the balance is flagged as genuine drift. (Phase H may backfill an
 *    opening-balance ledger row, after which a SUM(delta) check could replace
 *    this.)
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Scheduling moved to @scadium/worker (BullMQ repeatable job). `reconcileAll`
  // is the callable entrypoint the worker processor invokes hourly.

  /**
   * Recompute aggregates + derived balance and append a `ReconciliationDrift`
   * row per mismatched field. Returns the number of drift rows written.
   * FLAG ONLY — never mutates `User`.
   */
  async reconcileAll(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      // Single grouped pass over Bet for all five aggregates.
      const betAgg = await tx.$queryRaw<
        Array<{
          userId: string;
          wagered: bigint | string;
          won: bigint | string;
          lost: bigint | string;
          biggest: bigint | string;
          games: bigint | string;
        }>
      >(Prisma.sql`
        SELECT "userId",
               COALESCE(SUM("amountLamports"), 0) AS wagered,
               COALESCE(SUM(GREATEST("payoutLamports" - "amountLamports", 0)), 0) AS won,
               COALESCE(SUM(GREATEST("amountLamports" - "payoutLamports", 0)), 0) AS lost,
               COALESCE(GREATEST(MAX("payoutLamports" - "amountLamports"), 0), 0) AS biggest,
               COUNT(*) AS games
        FROM "Bet"
        GROUP BY "userId"
      `);

      // Latest ledger checkpoint per user. We compare the live balance against
      // the MOST RECENT row's `balanceAfter` (not SUM(delta)): new users are
      // funded with a 10 SOL default that is NOT ledgered, so SUM(delta) would
      // under-report by the opening balance and false-positive every active
      // user. `applyBalanceDelta` always stamps `balanceAfter` = the live
      // balance right after the mutation, so for any untampered user the latest
      // `balanceAfter` equals `playBalanceLamports`; a direct (non-ledgered)
      // write to the balance breaks that equality and is flagged.
      const ledgerAgg = await tx.$queryRaw<Array<{ userId: string; latest: bigint | string }>>(
        Prisma.sql`
          SELECT "userId", "balanceAfter" AS latest
          FROM (
            SELECT "userId", "balanceAfter",
                   ROW_NUMBER() OVER (
                     PARTITION BY "userId" ORDER BY "createdAt" DESC, "id" DESC
                   ) AS rn
            FROM "BalanceLedger"
          ) t
          WHERE rn = 1
        `,
      );

      const betByUser = new Map(betAgg.map((r) => [r.userId, r]));
      const ledgerByUser = new Map(ledgerAgg.map((r) => [r.userId, r]));

      // Pull the live User columns for everyone. (User counts are bounded for
      // this play-money phase; Phase H can page this in the worker.)
      const users = await tx.user.findMany({
        select: {
          id: true,
          totalWagered: true,
          totalWon: true,
          totalLost: true,
          biggestWin: true,
          gamesPlayed: true,
          playBalanceLamports: true,
        },
      });

      const drifts: Prisma.ReconciliationDriftCreateManyInput[] = [];

      const flag = (userId: string, field: string, stored: bigint, derived: bigint) => {
        if (stored !== derived) {
          drifts.push({
            userId,
            field,
            storedValue: stored.toString(),
            derivedValue: derived.toString(),
          });
        }
      };

      for (const u of users) {
        const bets = betByUser.get(u.id);
        // A user with no bets derives all-zero aggregates.
        const wagered = bets ? BigInt(bets.wagered.toString()) : 0n;
        const won = bets ? BigInt(bets.won.toString()) : 0n;
        const lost = bets ? BigInt(bets.lost.toString()) : 0n;
        const biggest = bets ? BigInt(bets.biggest.toString()) : 0n;
        const games = bets ? Number(BigInt(bets.games.toString())) : 0;

        flag(u.id, 'totalWagered', u.totalWagered, wagered);
        flag(u.id, 'totalWon', u.totalWon, won);
        flag(u.id, 'totalLost', u.totalLost, lost);
        flag(u.id, 'biggestWin', u.biggestWin, biggest);
        flag(u.id, 'gamesPlayed', BigInt(u.gamesPlayed), BigInt(games));

        // playBalance: only for users WITH ledger rows (see class doc). The
        // derived value is the latest row's `balanceAfter`, which includes the
        // un-ledgered opening balance.
        const ledger = ledgerByUser.get(u.id);
        if (ledger) {
          flag(u.id, 'playBalanceLamports', u.playBalanceLamports, BigInt(ledger.latest.toString()));
        }
      }

      if (drifts.length > 0) {
        await tx.reconciliationDrift.createMany({ data: drifts });
      }

      this.logger.log(
        `reconciliation: scanned ${users.length} user(s), flagged ${drifts.length} drift row(s)`,
      );
      // Metric hook (Phase H emits to a real collector).
      return drifts.length;
    });
  }
}
