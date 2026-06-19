import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ENGINE } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ChainService } from '../solana/chain.service';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { withSerializable } from '../prisma/with-serializable';

/**
 * SCAD Engine — staking (bc.game parity).
 *
 * Earned $SCAD (`User.scadiumBalance`, redeemable) is moved into a LOCKED staked
 * balance (`User.scadiumStaked`). Stakers earn a pro-rata USDS dividend every
 * distribution round (see DistributionService). Staking is a purely OFF-CHAIN
 * ledger move — independent of `ChainService.enabled` — so it works in the
 * current play-money phase; the USDS payout is what's later bridged on-chain.
 *
 * Every move goes through `applyBalanceDelta` so a `scad` debit + `scad_staked`
 * credit (or the reverse on unstake) are written with their ledger rows in ONE
 * transaction. A single `stakeLockedUntil` per user governs the whole staked
 * balance; staking more RESETS the lock on the full balance (simplest faithful
 * model — no per-deposit lock bookkeeping).
 */
@Injectable()
export class StakingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {}

  /** Move `amount` $SCAD base units from spendable balance into the staked, locked balance. */
  async stake(userId: string, amount: bigint) {
    if (amount < BigInt(ENGINE.MIN_STAKE_SCAD_BASE)) {
      throw new BadRequestException(
        `Minimum stake is ${ENGINE.MIN_STAKE_SCAD_BASE} SCAD base units`,
      );
    }
    return this.move(userId, amount, 'stake');
  }

  /** Stake the user's ENTIRE spendable $SCAD balance (the "claim & stake" action). */
  async claimAndStake(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { scadiumBalance: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.scadiumBalance < BigInt(ENGINE.MIN_STAKE_SCAD_BASE)) {
      throw new BadRequestException('Nothing to stake');
    }
    return this.move(userId, user.scadiumBalance, 'auto_stake');
  }

  /** Move `amount` staked $SCAD back to the spendable balance — only after the lock elapses. */
  async unstake(userId: string, amount: bigint) {
    if (amount <= 0n) throw new BadRequestException('Amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { scadiumStaked: true, stakeLockedUntil: true },
      });
      if (!user) throw new NotFoundException('User not found');
      if (amount > user.scadiumStaked) {
        throw new BadRequestException('Amount exceeds staked balance');
      }
      const now = new Date();
      if (user.stakeLockedUntil && user.stakeLockedUntil > now) {
        throw new BadRequestException(
          `Staked SCAD is locked until ${user.stakeLockedUntil.toISOString()}`,
        );
      }

      // staked → spendable, both legs ledgered atomically.
      const stakedAfter = await applyBalanceDelta(tx, userId, -amount, {
        currency: 'scad_staked',
        reason: 'unstake',
        refType: 'StakeEvent',
      });
      await applyBalanceDelta(tx, userId, amount, {
        currency: 'scad',
        reason: 'unstake',
        refType: 'StakeEvent',
      });
      await tx.stakeEvent.create({
        data: { userId, kind: 'unstake', amountScad: amount, stakedAfter },
      });
      return this.serializeSummary(tx, userId);
    });
  }

  async summary(userId: string) {
    // Auto-stake fires lazily on the staking touch: before serializing, sweep any
    // spendable earned $SCAD into the locked stake (no-op unless enabled + above
    // MIN_STAKE). This is the simplest safe trigger — it keeps the hot per-bet
    // settlement path untouched (accrue() stays a pure credit) yet runs for every
    // active player, since the /engine dashboard polls /staking/summary.
    await this.autoStakeSweep(userId);
    return this.serializeSummary(this.prisma, userId);
  }

  /** Read the user's auto-stake preference. */
  async getAutoStake(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { autoStakeEnabled: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user.autoStakeEnabled;
  }

  /** Set the user's auto-stake preference; sweeps immediately when turning it ON. */
  async setAutoStake(userId: string, enabled: boolean): Promise<boolean> {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { autoStakeEnabled: enabled },
    });
    if (count === 0) throw new NotFoundException('User not found');
    if (enabled) await this.autoStakeSweep(userId);
    return enabled;
  }

  /**
   * Sweep the user's spendable earned $SCAD into the locked staked balance IF
   * `autoStakeEnabled` AND the spendable balance is ≥ ENGINE.MIN_STAKE_SCAD_BASE.
   * Reuses the EXACT stake semantics (applyBalanceDelta scad→scad_staked, reset
   * `stakeLockedUntil`, `StakeEvent kind:'auto_stake'`) in ONE $transaction, so
   * the auto-stake leaves the same ledger trail as a manual stake and keeps
   * `stakeLedgerDrift()` at zero. No-op (returns 0n) when disabled or below MIN.
   */
  async autoStakeSweep(userId: string): Promise<bigint> {
    // Serializable (not a bare $transaction): this fires automatically on every
    // /staking/summary poll (30s, and once per open tab), so concurrent sweeps for
    // the same user are realistic. Serializable makes the race-loser abort with
    // 40001 → withSerializable retries the closure, re-reads a now-zero spendable
    // balance, and returns 0n cleanly instead of 500-ing the summary with the
    // applyBalanceDelta "Insufficient balance" guard.
    return withSerializable(this.prisma, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { autoStakeEnabled: true, scadiumBalance: true, stakeLockedUntil: true },
      });
      if (!user || !user.autoStakeEnabled) return 0n;
      if (user.scadiumBalance < BigInt(ENGINE.MIN_STAKE_SCAD_BASE)) return 0n;

      const amount = user.scadiumBalance;
      // Debit spendable first — the guarded updateMany rejects on insufficient
      // balance, the same atomic guarantee the manual stake path relies on.
      await applyBalanceDelta(tx, userId, -amount, {
        currency: 'scad',
        reason: 'auto_stake',
        refType: 'StakeEvent',
      });
      const stakedAfter = await applyBalanceDelta(tx, userId, amount, {
        currency: 'scad_staked',
        reason: 'auto_stake',
        refType: 'StakeEvent',
      });
      // Unlike a MANUAL stake (a deliberate action that resets the whole-balance
      // lock), an automatic sweep must NOT perpetually extend the lock — otherwise
      // an active player whose earnings sweep every 30s could never reach an
      // unstake window. Preserve any existing unexpired lock; only start a fresh
      // 7-day lock when the stake is currently unlocked.
      const now = Date.now();
      const lockedUntil =
        user.stakeLockedUntil && user.stakeLockedUntil.getTime() > now
          ? user.stakeLockedUntil
          : new Date(now + ENGINE.LOCK_PERIOD_MS);
      await tx.user.update({ where: { id: userId }, data: { stakeLockedUntil: lockedUntil } });
      await tx.stakeEvent.create({
        data: { userId, kind: 'auto_stake', amountScad: amount, stakedAfter, lockedUntil },
      });
      return amount;
    });
  }

  // ------------------------------------------------------------- internals

  /** Shared stake/auto-stake path: spendable → staked, set the lock, record the event. */
  private async move(userId: string, amount: bigint, kind: 'stake' | 'auto_stake') {
    return this.prisma.$transaction(async (tx) => {
      // Debit spendable $SCAD first — the guarded updateMany rejects if the
      // balance is insufficient (atomic, same row-lock guarantee as wagering).
      await applyBalanceDelta(tx, userId, -amount, {
        currency: 'scad',
        reason: kind,
        refType: 'StakeEvent',
      });
      const stakedAfter = await applyBalanceDelta(tx, userId, amount, {
        currency: 'scad_staked',
        reason: kind,
        refType: 'StakeEvent',
      });
      const lockedUntil = new Date(Date.now() + ENGINE.LOCK_PERIOD_MS);
      await tx.user.update({ where: { id: userId }, data: { stakeLockedUntil: lockedUntil } });
      await tx.stakeEvent.create({
        data: { userId, kind, amountScad: amount, stakedAfter, lockedUntil },
      });
      return this.serializeSummary(tx, userId);
    });
  }

  /**
   * Staking dashboard payload: staked/lock state, USDS earned, and a rough APY
   * estimated from the most recent distributed round
   * (per-round yield × rounds-per-year), expressed as a percentage string.
   */
  private async serializeSummary(
    db: PrismaService | Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    userId: string,
  ) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        scadiumBalance: true,
        scadiumStaked: true,
        stakeLockedUntil: true,
        usdsBalance: true,
        usdsReserved: true,
        autoStakeEnabled: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const earned = await db.distributionClaim.aggregate({
      where: { userId },
      _sum: { shareUsds: true },
    });

    const lastRound = await db.distributionRound.findFirst({
      where: { distributed: true, totalStakedSnapshot: { gt: 0n } },
      orderBy: { distributedAt: 'desc' },
      select: { poolUsds: true, totalStakedSnapshot: true },
    });

    const now = Date.now();
    const locked = !!user.stakeLockedUntil && user.stakeLockedUntil.getTime() > now;

    return {
      spendableScad: user.scadiumBalance.toString(),
      stakedScad: user.scadiumStaked.toString(),
      locked,
      lockedUntil: user.stakeLockedUntil ? user.stakeLockedUntil.toISOString() : null,
      usdsBalance: user.usdsBalance.toString(),
      usdsReserved: user.usdsReserved.toString(),
      totalUsdsEarned: (earned._sum.shareUsds ?? 0n).toString(),
      estApyPct: estimateApyPct(lastRound),
      lockPeriodMs: ENGINE.LOCK_PERIOD_MS,
      autoStakeEnabled: user.autoStakeEnabled,
      minStakeScad: ENGINE.MIN_STAKE_SCAD_BASE.toString(),
      // #208: the on-chain USDS claim (withdraw) leg only works when the chain is
      // live; the UI uses this to flag the claim as devnet/decorative when off,
      // instead of letting the button throw. Dividend accrual itself is off-chain.
      chainEnabled: this.chain.enabled,
    };
  }
}

/**
 * Rough APY from the last round: the per-round dividend yield on staked value,
 * scaled to hourly rounds per year. SCAD↔USDS use different units/pegs, so this
 * is an indicative pool-relative figure (USDS pool ÷ staked SCAD × rounds/yr),
 * not a precise on-value return — the UI labels it "est.".
 */
export function estimateApyPct(
  lastRound: { poolUsds: bigint; totalStakedSnapshot: bigint } | null,
): number {
  if (!lastRound || lastRound.totalStakedSnapshot <= 0n) return 0;
  const roundsPerYear = (365 * 24 * 60 * 60 * 1000) / ENGINE.DISTRIBUTION_INTERVAL_MS;
  const perRoundYield = Number(lastRound.poolUsds) / Number(lastRound.totalStakedSnapshot);
  return Math.round(perRoundYield * roundsPerYear * 100 * 100) / 100;
}
