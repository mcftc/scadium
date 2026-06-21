import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  VAULT,
  assetsForShares,
  sharesForDeposit,
  earlyExitPenalty,
  applyAccrual,
} from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { withSerializable } from '../prisma/with-serializable';

/**
 * SCAD Vault — term staking (the LOCKED "vadeli" tier; the Engine is the liquid
 * one). A deposit locks $SCAD into a chosen term pool as its own POSITION (a
 * fixed-term contract with its own `maturesAt`). Accounting is share/index based
 * (ERC-4626-style): `pool.indexRay` is the share price; a deposit mints
 * `assets · RAY / index` shares at the current price (index unchanged); yield
 * (V5 accrual) and early-exit penalties RAISE the index, so every remaining
 * position appreciates pro-rata in O(1).
 *
 * Early (pre-maturity) withdrawal is allowed but charged
 * `VAULT.EARLY_EXIT_PENALTY_BPS`; the penalty STAYS in the pool (credited to the
 * index via `applyAccrual`), rewarding stakers who hold to maturity.
 *
 * Money discipline mirrors the Engine: every leg goes through `applyBalanceDelta`
 * (a `scad` ↔ `scad_vault` move + its ledger row) inside ONE Serializable
 * transaction, so concurrent deposits/withdrawals on the same pool either
 * serialize or retry (40001) — never corrupt the pool totals.
 */
@Injectable()
export class VaultService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active term pools (API-facing, BigInts serialized to strings). */
  async pools() {
    const pools = await this.prisma.vaultPool.findMany({
      where: { active: true },
      orderBy: { termDays: 'asc' },
    });
    return pools.map((p) => ({
      id: p.id,
      asset: p.asset,
      termDays: p.termDays,
      weightBps: p.weightBps,
      aprBps: p.aprBps,
      indexRay: p.indexRay.toString(),
      totalAssets: p.totalAssets.toString(),
      totalShares: p.totalShares.toString(),
    }));
  }

  /** A user's vault positions with their CURRENT value (shares × pool index). */
  async positions(userId: string) {
    const positions = await this.prisma.vaultPosition.findMany({
      where: { userId },
      include: { pool: true },
      orderBy: { createdAt: 'desc' },
    });
    const now = Date.now();
    return positions.map((pos) => {
      const value = assetsForShares(pos.shares, pos.pool.indexRay);
      return {
        id: pos.id,
        poolId: pos.poolId,
        termDays: pos.pool.termDays,
        asset: pos.pool.asset,
        shares: pos.shares.toString(),
        principal: pos.principal.toString(),
        value: value.toString(),
        earned: (value - pos.principal).toString(),
        maturesAt: pos.maturesAt.toISOString(),
        matured: pos.maturesAt.getTime() <= now,
        indexRay: pos.pool.indexRay.toString(),
        aprBps: pos.pool.aprBps,
      };
    });
  }

  /**
   * Lock `amount` $SCAD base units into `poolId` as a new term position. Debits
   * spendable `scad`, credits the `scad_vault` principal aggregate, mints shares
   * at the pool's current index (index unchanged), and stamps `maturesAt`.
   */
  async deposit(userId: string, poolId: string, amount: bigint) {
    if (amount < BigInt(VAULT.MIN_DEPOSIT_SCAD_BASE)) {
      throw new BadRequestException(
        `Minimum deposit is ${VAULT.MIN_DEPOSIT_SCAD_BASE} SCAD base units`,
      );
    }

    return withSerializable(this.prisma, async (tx) => {
      const pool = await tx.vaultPool.findUnique({ where: { id: poolId } });
      if (!pool || !pool.active) throw new NotFoundException('Vault pool not found');

      const shares = sharesForDeposit(amount, pool.indexRay);
      if (shares <= 0n) throw new BadRequestException('Deposit too small to mint shares');

      // scad → scad_vault, both legs ledgered atomically. The debit's guarded
      // updateMany rejects on insufficient spendable balance.
      await applyBalanceDelta(tx, userId, -amount, {
        currency: 'scad',
        reason: 'vault_deposit',
        refType: 'VaultEvent',
        refId: poolId,
      });
      await applyBalanceDelta(tx, userId, amount, {
        currency: 'scad_vault',
        reason: 'vault_deposit',
        refType: 'VaultEvent',
        refId: poolId,
      });

      // Mint shares at the current price → index is unchanged by a deposit.
      await tx.vaultPool.update({
        where: { id: poolId },
        data: {
          totalAssets: { increment: amount },
          totalShares: { increment: shares },
        },
      });

      const maturesAt = new Date(Date.now() + pool.termDays * 24 * 60 * 60 * 1000);
      const position = await tx.vaultPosition.create({
        data: { userId, poolId, shares, principal: amount, maturesAt },
      });

      await tx.vaultEvent.create({
        data: {
          userId,
          poolId,
          kind: 'deposit',
          assetsDelta: amount,
          sharesDelta: shares,
          penaltyAssets: 0n,
          indexRayAfter: pool.indexRay,
        },
      });

      return {
        positionId: position.id,
        shares: shares.toString(),
        principal: amount.toString(),
        maturesAt: maturesAt.toISOString(),
      };
    });
  }

  /**
   * Withdraw `shares` from a position (or the whole position when `shares` is
   * omitted). At/after maturity the user receives the full asset value; BEFORE
   * maturity an `EARLY_EXIT_PENALTY_BPS` cut is taken and left in the pool
   * (raising the index for the remaining stakers). Credits spendable `scad` with
   * the net, debits the `scad_vault` principal aggregate by the proportional
   * principal.
   */
  async withdraw(userId: string, positionId: string, shares?: bigint) {
    return withSerializable(this.prisma, async (tx) => {
      const position = await tx.vaultPosition.findUnique({
        where: { id: positionId },
        include: { pool: true },
      });
      if (!position || position.userId !== userId) {
        throw new NotFoundException('Vault position not found');
      }

      const sharesToBurn = shares === undefined ? position.shares : shares;
      if (sharesToBurn <= 0n) throw new BadRequestException('Shares must be positive');
      if (sharesToBurn > position.shares) {
        throw new BadRequestException('Shares exceed position');
      }

      const pool = position.pool;
      const gross = assetsForShares(sharesToBurn, pool.indexRay);
      const isEarly = position.maturesAt.getTime() > Date.now();
      const penalty = isEarly ? earlyExitPenalty(gross) : 0n;
      const net = gross - penalty;

      // Proportional principal removed from the scad_vault aggregate.
      const principalPortion =
        sharesToBurn === position.shares
          ? position.principal
          : (position.principal * sharesToBurn) / position.shares;

      // Pool: remove the burned shares and the NET assets; the penalty stays as
      // pool assets and is credited to the remaining shares via the index.
      const newTotalShares = pool.totalShares - sharesToBurn;
      let newTotalAssets = pool.totalAssets - net;
      let newIndexRay: bigint;
      if (newTotalShares <= 0n) {
        // Last shares out: nothing left to credit the penalty to — reset the
        // empty pool to genesis (the orphaned penalty is retained as pool dust).
        newIndexRay = VAULT.INITIAL_INDEX_RAY;
        newTotalAssets = 0n;
      } else {
        newIndexRay = applyAccrual(pool.indexRay, newTotalShares, penalty);
      }

      // scad_vault → scad, both legs ledgered atomically.
      await applyBalanceDelta(tx, userId, -principalPortion, {
        currency: 'scad_vault',
        reason: isEarly ? 'vault_early_exit' : 'vault_withdraw',
        refType: 'VaultEvent',
        refId: positionId,
      });
      if (net > 0n) {
        await applyBalanceDelta(tx, userId, net, {
          currency: 'scad',
          reason: isEarly ? 'vault_early_exit' : 'vault_withdraw',
          refType: 'VaultEvent',
          refId: positionId,
        });
      }

      await tx.vaultPool.update({
        where: { id: pool.id },
        data: {
          totalShares: newTotalShares < 0n ? 0n : newTotalShares,
          totalAssets: newTotalAssets,
          indexRay: newIndexRay,
        },
      });

      const remainingShares = position.shares - sharesToBurn;
      if (remainingShares <= 0n) {
        await tx.vaultPosition.delete({ where: { id: positionId } });
      } else {
        await tx.vaultPosition.update({
          where: { id: positionId },
          data: { shares: remainingShares, principal: position.principal - principalPortion },
        });
      }

      await tx.vaultEvent.create({
        data: {
          userId,
          poolId: pool.id,
          kind: isEarly ? 'early_exit' : 'withdraw',
          assetsDelta: -net,
          sharesDelta: -sharesToBurn,
          penaltyAssets: penalty,
          indexRayAfter: newIndexRay,
        },
      });

      return {
        positionId,
        sharesBurned: sharesToBurn.toString(),
        grossAssets: gross.toString(),
        penaltyAssets: penalty.toString(),
        netAssets: net.toString(),
        early: isEarly,
      };
    });
  }
}
