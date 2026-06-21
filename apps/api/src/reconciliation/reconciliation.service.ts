import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HOUSE } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ChainService } from '../solana/chain.service';
import { settlementMoved } from '../solana/settlement-verify';
import { houseVaultLamports, lowBankrollAlertsTotal } from '../observability/metrics.registry';

/** Rent::minimum_balance(0) on mainnet params — the house_vault PDA holds no
 * data, so this is its non-spendable floor (mirrors the on-chain check). */
const HOUSE_VAULT_RENT_FLOOR = 890_880n;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {}

  /**
   * On-chain receipt drift check (#26): for recent Bets carrying a
   * txSignature, re-fetch the confirmed transaction and assert it (a)
   * succeeded and (b) moved exactly the expected house-vault lamports —
   * today every receipt is a play-money `record_bet`, so the expected
   * movement is ZERO; the funded `settle_bet` expectation (±net) plugs in
   * with J3 once bets are tagged as vault-settled. Returns the number of
   * drifted receipts (flag-only; never mutates).
   */
  /**
   * Funded-custody drift (#27): for converted (vaultAddress != null) users the
   * spendable balance is a cache of on-chain vault custody ± settled-unswept
   * play. Flags users whose |spendable − vault-above-rent| exceeds the
   * tolerance. Flag-only.
   */
  async fundedDrift(toleranceLamports = 0n, limit = 100): Promise<number> {
    if (!this.chain.enabled) return 0;
    const users = await this.prisma.user.findMany({
      where: { vaultAddress: { not: null } },
      take: limit,
      select: { id: true, walletAddress: true, playBalanceLamports: true },
    });
    let drift = 0;
    for (const u of users) {
      try {
        const vault = await this.chain.vaultBalance(u.walletAddress);
        // UserVault rent floor is not spendable; the program enforces it on
        // withdraw, so compare against the above-rent custody.
        const rent = 1_002_240n; // Rent::minimum_balance(UserVault::SIZE) on mainnet params
        const backing = vault > rent ? vault - rent : 0n;
        const delta =
          u.playBalanceLamports > backing
            ? u.playBalanceLamports - backing
            : backing - u.playBalanceLamports;
        if (delta > toleranceLamports) {
          drift += 1;
          this.logger.error(
            `funded drift: user ${u.id} spendable=${u.playBalanceLamports} vault-above-rent=${backing}`,
          );
        }
      } catch (e) {
        drift += 1;
        this.logger.error(`funded drift: user ${u.id} unverifiable: ${String(e)}`);
      }
    }
    return drift;
  }

  /**
   * SCAD Vault drift (#259): for each active term pool, compares the off-chain
   * projection (`VaultPool.totalAssets`) with the on-chain pool's `total_assets`.
   * Flag-only; no-op while the chain is disabled (the on-chain pool doesn't exist
   * yet). Returns the number of pools whose |off − on| exceeds the tolerance.
   */
  async vaultDrift(toleranceBase = 0n): Promise<number> {
    if (!this.chain.enabled) return 0;
    const pools = await this.prisma.vaultPool.findMany({ where: { active: true } });
    let drift = 0;
    for (const p of pools) {
      try {
        const onChain = await this.chain.readVaultPoolOnChain(p.termDays);
        if (!onChain) continue; // pool not yet created on-chain — nothing to compare
        const delta =
          p.totalAssets > onChain.totalAssets
            ? p.totalAssets - onChain.totalAssets
            : onChain.totalAssets - p.totalAssets;
        if (delta > toleranceBase) {
          drift += 1;
          this.logger.error(
            `vault drift: pool ${p.termDays}d off-chain=${p.totalAssets} on-chain=${onChain.totalAssets}`,
          );
        }
      } catch (e) {
        drift += 1;
        this.logger.error(`vault drift: pool ${p.termDays}d unverifiable: ${String(e)}`);
      }
    }
    return drift;
  }

  /**
   * SCAD Vault OFF-CHAIN ledger drift (V8): asserts the bookkeeping invariants
   * that must always hold regardless of chain state —
   *   (1) per pool: `VaultPool.totalShares` == Σ position shares, and
   *   (2) per user: `User.scadiumVault` == Σ position principal.
   * Both are maintained leg-by-leg by VaultService through `applyBalanceDelta`,
   * so a non-zero result means a bug, not chain lag. Flag-only; returns the
   * number of violated invariants (0 = healthy).
   */
  async vaultLedgerDrift(): Promise<number> {
    let drift = 0;

    const pools = await this.prisma.vaultPool.findMany({
      select: { id: true, termDays: true, totalShares: true },
    });
    for (const p of pools) {
      const agg = await this.prisma.vaultPosition.aggregate({
        where: { poolId: p.id },
        _sum: { shares: true },
      });
      const sum = agg._sum.shares ?? 0n;
      if (sum !== p.totalShares) {
        drift += 1;
        this.logger.error(
          `vault ledger drift: pool ${p.termDays}d totalShares=${p.totalShares} Σpositions=${sum}`,
        );
      }
    }

    const users = await this.prisma.user.findMany({
      where: { scadiumVault: { gt: 0n } },
      select: { id: true, scadiumVault: true },
    });
    for (const u of users) {
      const agg = await this.prisma.vaultPosition.aggregate({
        where: { userId: u.id },
        _sum: { principal: true },
      });
      const sum = agg._sum.principal ?? 0n;
      if (sum !== u.scadiumVault) {
        drift += 1;
        this.logger.error(
          `vault ledger drift: user ${u.id} scadiumVault=${u.scadiumVault} Σprincipal=${sum}`,
        );
      }
    }

    return drift;
  }

  /**
   * House solvency monitor (#30): publishes the live bankroll gauge and alerts
   * when `house_vault` falls under rent floor + MIN_BANKROLL_BUFFER — see
   * docs/bankroll-model.md. Flag-only; the on-chain rent-floor check in
   * `settle_bet` is the hard stop, this is the early warning.
   */
  async houseSolvency(): Promise<{
    balanceLamports: bigint;
    floorLamports: bigint;
    ok: boolean;
  } | null> {
    if (!this.chain.enabled) return null;
    const balance = await this.chain.houseVaultBalance();
    if (balance === null) {
      this.logger.warn('house solvency: bankroll unreadable (RPC down?) — skipping this sweep');
      return null;
    }
    const floor = HOUSE_VAULT_RENT_FLOOR + BigInt(HOUSE.MIN_BANKROLL_BUFFER_LAMPORTS);
    houseVaultLamports.set(Number(balance));
    const ok = balance >= floor;
    if (!ok) {
      lowBankrollAlertsTotal.inc();
      this.logger.error(
        `LOW BANKROLL: house_vault=${balance} < rent floor + buffer (${floor}) — top up or pause funded settles`,
      );
    }
    return { balanceLamports: balance, floorLamports: floor, ok };
  }

  /**
   * Lottery prize sweep (#29): winning tickets of settled draws whose
   * prizeTxSignature is still null (solvency deferral, transient RPC failure,
   * crash between pay and mark). Aggregated per (draw, winner) — the on-chain
   * Payout PDA is keyed that way and doubles as the double-pay backstop.
   * Returns the number of payout attempts made.
   */
  async sweepLotteryPrizes(limit = 100): Promise<number> {
    if (!this.chain.lotteryEnabled) return 0;
    const unpaid = await this.prisma.lotteryTicket.findMany({
      where: {
        won: true,
        prizeTxSignature: null,
        draw: { status: 'drawn', drawIndex: { not: null } },
      },
      take: limit,
      include: {
        user: { select: { walletAddress: true } },
        draw: { select: { drawIndex: true } },
      },
    });
    // Group per (drawIndex, wallet).
    const groups = new Map<
      string,
      { drawIndex: bigint; walletAddress: string; amount: bigint; bracket: number; ids: string[] }
    >();
    for (const t of unpaid) {
      const key = `${t.draw.drawIndex}|${t.user.walletAddress}`;
      const g = groups.get(key) ?? {
        drawIndex: t.draw.drawIndex!,
        walletAddress: t.user.walletAddress,
        amount: BigInt(0),
        bracket: t.bracket ?? 0,
        ids: [],
      };
      g.amount += t.payoutScadBase;
      g.bracket = Math.max(g.bracket, t.bracket ?? 0);
      g.ids.push(t.id);
      groups.set(key, g);
    }
    let attempts = 0;
    const treasury = await this.chain.lotteryTreasuryBalance();
    let budget = treasury;
    for (const g of groups.values()) {
      if (g.amount > budget) {
        this.logger.error(
          `lottery sweep SOLVENCY: draw ${g.drawIndex} winner ${g.walletAddress} needs ${g.amount}, ` +
            `treasury budget ${budget} — deferred`,
        );
        continue;
      }
      attempts += 1;
      try {
        const sig = await this.chain.lotteryPayPrize({
          drawIndex: g.drawIndex,
          walletAddress: g.walletAddress,
          amountScadBase: g.amount,
          bracket: g.bracket,
        });
        if (sig) {
          budget -= g.amount;
          await this.prisma.lotteryTicket.updateMany({
            where: { id: { in: g.ids } },
            data: { prizeTxSignature: sig },
          });
        }
      } catch (e) {
        this.logger.error(`lottery sweep pay_prize failed for ${g.walletAddress}: ${String(e)}`);
      }
    }
    return attempts;
  }

  /**
   * Per-draw payout reconciliation (#29): Σ confirmed (signed) prizes must
   * equal Σ declared winning prizes for every settled draw. Returns the number
   * of drifted draws (flag-only).
   */
  async lotteryPayoutDrift(limit = 50): Promise<number> {
    if (!this.chain.lotteryEnabled) return 0;
    const draws = await this.prisma.lotteryDraw.findMany({
      where: { status: 'drawn', drawIndex: { not: null } },
      orderBy: { drawnAt: 'desc' },
      take: limit,
      select: { id: true, drawIndex: true },
    });
    let drift = 0;
    for (const d of draws) {
      const [declared, confirmed] = await Promise.all([
        this.prisma.lotteryTicket.aggregate({
          where: { drawId: d.id, won: true },
          _sum: { payoutScadBase: true },
        }),
        this.prisma.lotteryTicket.aggregate({
          where: { drawId: d.id, won: true, prizeTxSignature: { not: null } },
          _sum: { payoutScadBase: true },
        }),
      ]);
      const dec = declared._sum.payoutScadBase ?? BigInt(0);
      const conf = confirmed._sum.payoutScadBase ?? BigInt(0);
      if (dec !== conf) {
        drift += 1;
        this.logger.error(
          `lottery payout drift: draw #${d.drawIndex} declared ${dec} vs confirmed ${conf}`,
        );
      }
    }
    return drift;
  }

  /**
   * SCAD Engine staked-balance drift: `User.scadiumStaked` must equal the latest
   * `BalanceLedger` `balanceAfter` for currency `scad_staked` (every stake/
   * unstake moves through `applyBalanceDelta`, which ledgers it). Unlike the play
   * balance, staked SCAD has NO un-ledgered opening balance, so a user with no
   * scad_staked ledger row must have `scadiumStaked = 0` — a non-zero value there
   * is a direct write and is flagged. Flag-only; appends `ReconciliationDrift`.
   */
  async stakeLedgerDrift(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const ledgerAgg = await tx.$queryRaw<Array<{ userId: string; latest: bigint | string }>>(
        Prisma.sql`
          SELECT "userId", "balanceAfter" AS latest
          FROM (
            SELECT "userId", "balanceAfter",
                   ROW_NUMBER() OVER (
                     PARTITION BY "userId" ORDER BY "createdAt" DESC, "id" DESC
                   ) AS rn
            FROM "BalanceLedger"
            WHERE "currency" = 'scad_staked'
          ) t
          WHERE rn = 1
        `,
      );
      const latestByUser = new Map(ledgerAgg.map((r) => [r.userId, BigInt(r.latest.toString())]));

      // Only users who either hold a staked balance or have a scad_staked ledger
      // row are relevant — bounded for this phase.
      const users = await tx.user.findMany({
        where: { OR: [{ scadiumStaked: { gt: 0n } }, { id: { in: [...latestByUser.keys()] } }] },
        select: { id: true, scadiumStaked: true },
      });

      const drifts: Prisma.ReconciliationDriftCreateManyInput[] = [];
      for (const u of users) {
        const derived = latestByUser.get(u.id) ?? 0n;
        if (u.scadiumStaked !== derived) {
          drifts.push({
            userId: u.id,
            field: 'scadiumStaked',
            storedValue: u.scadiumStaked.toString(),
            derivedValue: derived.toString(),
          });
        }
      }
      if (drifts.length > 0) await tx.reconciliationDrift.createMany({ data: drifts });
      if (drifts.length > 0) {
        this.logger.error(`stake drift: flagged ${drifts.length} scadiumStaked mismatch(es)`);
      }
      return drifts.length;
    });
  }

  /**
   * Spendable $SCAD ledger drift (#229): `User.scadiumBalance` must equal the
   * latest `BalanceLedger` `balanceAfter` for currency `scad`. Every $SCAD
   * movement — wager-reward credits (`accrue`) and stake-path debits — flows
   * through `applyBalanceDelta`, which ledgers it, and $SCAD has NO un-ledgered
   * opening balance (new users start at 0). So a user with no `scad` ledger row
   * must have `scadiumBalance = 0`; any non-zero value there (or a checkpoint
   * mismatch) is a direct write and is flagged. Only users with `scad` activity
   * (a stored balance or a ledger row) are scanned. Flag-only; appends
   * `ReconciliationDrift`. Mirrors `stakeLedgerDrift`.
   */
  async scadLedgerDrift(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const ledgerAgg = await tx.$queryRaw<Array<{ userId: string; latest: bigint | string }>>(
        Prisma.sql`
          SELECT "userId", "balanceAfter" AS latest
          FROM (
            SELECT "userId", "balanceAfter",
                   ROW_NUMBER() OVER (
                     PARTITION BY "userId" ORDER BY "createdAt" DESC, "id" DESC
                   ) AS rn
            FROM "BalanceLedger"
            WHERE "currency" = 'scad'
          ) t
          WHERE rn = 1
        `,
      );
      const latestByUser = new Map(ledgerAgg.map((r) => [r.userId, BigInt(r.latest.toString())]));

      // Only users who either hold a spendable $SCAD balance or have a `scad`
      // ledger row are relevant — bounded for this phase.
      const users = await tx.user.findMany({
        where: { OR: [{ scadiumBalance: { gt: 0n } }, { id: { in: [...latestByUser.keys()] } }] },
        select: { id: true, scadiumBalance: true },
      });

      const drifts: Prisma.ReconciliationDriftCreateManyInput[] = [];
      for (const u of users) {
        const derived = latestByUser.get(u.id) ?? 0n;
        if (u.scadiumBalance !== derived) {
          drifts.push({
            userId: u.id,
            field: 'scadiumBalance',
            storedValue: u.scadiumBalance.toString(),
            derivedValue: derived.toString(),
          });
        }
      }
      if (drifts.length > 0) await tx.reconciliationDrift.createMany({ data: drifts });
      if (drifts.length > 0) {
        this.logger.error(`scad drift: flagged ${drifts.length} scadiumBalance mismatch(es)`);
      }
      return drifts.length;
    });
  }

  /**
   * USDS dividend solvency: the total outstanding USDS liability
   * (Σ `usdsBalance` + Σ `usdsReserved`) must be backed by the on-chain USDS
   * treasury. Flag-only early warning (the on-chain transfer is the hard stop);
   * returns null when the chain is disabled or the treasury is unreadable.
   */
  async usdsSolvency(): Promise<{ liability: bigint; treasury: bigint; ok: boolean } | null> {
    const agg = await this.prisma.user.aggregate({
      _sum: { usdsBalance: true, usdsReserved: true },
    });
    const liability = (agg._sum.usdsBalance ?? 0n) + (agg._sum.usdsReserved ?? 0n);
    const treasury = await this.chain.usdsTreasuryBalance();
    if (treasury === null) {
      this.logger.warn(
        `usds solvency: treasury unreadable (chain off?) — outstanding liability ${liability} USDS base`,
      );
      return null;
    }
    const ok = treasury >= liability;
    if (!ok) {
      this.logger.error(
        `USDS UNDER-RESERVED: liability=${liability} > treasury=${treasury} — top up the dividend treasury`,
      );
    }
    return { liability, treasury, ok };
  }

  async chainDrift(limit = 50): Promise<number> {
    if (!this.chain.enabled) return 0;
    const bets = await this.prisma.bet.findMany({
      where: { txSignature: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, txSignature: true },
    });
    const houseVault = this.chain.houseVaultPda().toBase58();
    let drift = 0;
    for (const bet of bets) {
      try {
        const tx = await this.chain.connection.getTransaction(bet.txSignature!, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        if (!settlementMoved(tx, houseVault, 0n)) {
          drift += 1;
          this.logger.error(
            `chain drift: bet ${bet.id} receipt ${bet.txSignature} failed or moved value unexpectedly`,
          );
        }
      } catch (e) {
        drift += 1;
        this.logger.error(`chain drift: bet ${bet.id} receipt unverifiable: ${String(e)}`);
      }
    }
    return drift;
  }

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
      // SCOPE to currency = 'jeton' (#229): BalanceLedger is now multi-currency
      // (jeton play balance, scad, scad_staked, usds). `playBalanceLamports`
      // must be compared against the latest PLAY-balance row's `balanceAfter` —
      // an unfiltered "latest row" picks up a later `scad`/`usds` movement whose
      // `balanceAfter` is a different balance entirely, false-positiving every
      // user who earned $SCAD after their last play-balance move.
      const ledgerAgg = await tx.$queryRaw<Array<{ userId: string; latest: bigint | string }>>(
        Prisma.sql`
          SELECT "userId", "balanceAfter" AS latest
          FROM (
            SELECT "userId", "balanceAfter",
                   ROW_NUMBER() OVER (
                     PARTITION BY "userId" ORDER BY "createdAt" DESC, "id" DESC
                   ) AS rn
            FROM "BalanceLedger"
            WHERE "currency" = 'jeton'
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
          flag(
            u.id,
            'playBalanceLamports',
            u.playBalanceLamports,
            BigInt(ledger.latest.toString()),
          );
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
