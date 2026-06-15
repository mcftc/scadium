import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { ComplianceService } from '../compliance/compliance.service';

export interface RgState {
  selfExcludedUntil: string | null;
  coolOffUntil: string | null;
  dailyDepositLimitLamports: string | null;
  dailyLossLimitLamports: string | null;
  dailyWagerLimitLamports: string | null;
}

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Responsible-gambling controls (#46): daily limits, cooling-off and a working
 * self-exclusion. `assertCanWager` is the single gate every game service routes
 * its wager through so the rules never diverge per game.
 */
@Injectable()
export class RgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maintenance: MaintenanceService,
    private readonly compliance: ComplianceService,
  ) {}

  async state(userId: string): Promise<RgState> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        selfExcludedUntil: true,
        coolOffUntil: true,
        dailyDepositLimitLamports: true,
        dailyLossLimitLamports: true,
        dailyWagerLimitLamports: true,
      },
    });
    return {
      selfExcludedUntil: u.selfExcludedUntil?.toISOString() ?? null,
      coolOffUntil: u.coolOffUntil?.toISOString() ?? null,
      dailyDepositLimitLamports: u.dailyDepositLimitLamports?.toString() ?? null,
      dailyLossLimitLamports: u.dailyLossLimitLamports?.toString() ?? null,
      dailyWagerLimitLamports: u.dailyWagerLimitLamports?.toString() ?? null,
    };
  }

  /**
   * Throw (403) if the user may not wager `amount` lamports right now:
   * self-excluded, in cooling-off, or today's wager/loss + amount would breach a
   * daily limit. Pass `0n` for non-SOL or non-wager money moves (lottery/tip) to
   * enforce only the self-exclusion + cooling-off blocks. This is a PRE-CHECK
   * before the debit — a tiny limit overshoot under heavy concurrency is
   * acceptable for a soft consumer-protection limit (the balance debit itself
   * stays atomic; the no-double-spend invariant is unaffected).
   */
  async assertCanWager(userId: string, amount: bigint): Promise<void> {
    // Global kill-switch (#56): no new wagers while paused for maintenance.
    if (await this.maintenance.isPaused()) {
      throw new ServiceUnavailableException('Wagering is paused for maintenance');
    }
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        ageConfirmedAt: true,
        selfExcludedUntil: true,
        coolOffUntil: true,
        dailyLossLimitLamports: true,
        dailyWagerLimitLamports: true,
      },
    });
    // Age gate (#146): real money requires a confirmed 18+ acknowledgement at the
    // API, not just the client modal (#44). Enforced only when real money is on —
    // the play-money demo's gate is a presented acknowledgement, not a control.
    if (this.compliance.realMoneyEnabled && u.ageConfirmedAt == null) {
      throw new ForbiddenException('Age verification required');
    }
    const now = new Date();
    if (u.selfExcludedUntil && u.selfExcludedUntil > now) {
      throw new ForbiddenException(`Self-excluded until ${u.selfExcludedUntil.toISOString()}`);
    }
    if (u.coolOffUntil && u.coolOffUntil > now) {
      throw new ForbiddenException(`Cooling-off until ${u.coolOffUntil.toISOString()}`);
    }
    if (amount <= 0n) return;
    if (u.dailyWagerLimitLamports == null && u.dailyLossLimitLamports == null) return;

    const agg = await this.prisma.bet.aggregate({
      where: { userId, createdAt: { gte: startOfUtcDay() } },
      _sum: { amountLamports: true, payoutLamports: true },
    });
    const wagered = agg._sum.amountLamports ?? 0n;
    const paid = agg._sum.payoutLamports ?? 0n;

    if (u.dailyWagerLimitLamports != null && wagered + amount > u.dailyWagerLimitLamports) {
      throw new ForbiddenException('Daily wager limit reached');
    }
    if (u.dailyLossLimitLamports != null) {
      const netLoss = wagered - paid > 0n ? wagered - paid : 0n;
      if (netLoss + amount > u.dailyLossLimitLamports) {
        throw new ForbiddenException('Daily loss limit reached');
      }
    }
  }

  /** Deposit guard (#46): today's deposits + amount must not exceed the limit. */
  async assertCanDeposit(userId: string, amount: bigint): Promise<void> {
    if (await this.maintenance.isPaused()) {
      throw new ServiceUnavailableException('Deposits are paused for maintenance');
    }
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { ageConfirmedAt: true, dailyDepositLimitLamports: true },
    });
    // Age gate (#146): block real-money deposits by an un-acknowledged user.
    if (this.compliance.realMoneyEnabled && u.ageConfirmedAt == null) {
      throw new ForbiddenException('Age verification required');
    }
    if (u.dailyDepositLimitLamports == null) return;
    const agg = await this.prisma.vaultTransfer.aggregate({
      where: { userId, kind: 'deposit', createdAt: { gte: startOfUtcDay() } },
      _sum: { amountLamports: true },
    });
    const today = agg._sum.amountLamports ?? 0n;
    if (today + amount > u.dailyDepositLimitLamports) {
      throw new ForbiddenException('Daily deposit limit reached');
    }
  }

  /** Set/clear daily limits. Lowering is immediate; `null` clears a limit. */
  async setLimits(
    userId: string,
    limits: { dailyDeposit?: bigint | null; dailyLoss?: bigint | null; dailyWager?: bigint | null },
  ): Promise<RgState> {
    const data: {
      dailyDepositLimitLamports?: bigint | null;
      dailyLossLimitLamports?: bigint | null;
      dailyWagerLimitLamports?: bigint | null;
    } = {};
    if (limits.dailyDeposit !== undefined) data.dailyDepositLimitLamports = limits.dailyDeposit;
    if (limits.dailyLoss !== undefined) data.dailyLossLimitLamports = limits.dailyLoss;
    if (limits.dailyWager !== undefined) data.dailyWagerLimitLamports = limits.dailyWager;
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.state(userId);
  }

  async setCoolOff(userId: string, until: Date): Promise<RgState> {
    return this.extend(userId, 'coolOffUntil', until, 'cooling-off');
  }

  async setSelfExclusion(userId: string, until: Date): Promise<RgState> {
    const result = await this.extend(userId, 'selfExcludedUntil', until, 'self-exclusion');
    // Terminate all live sessions so existing access/refresh tokens stop working
    // immediately — self-exclusion must lock the account, not just future bets.
    await this.prisma.session.deleteMany({ where: { userId } });
    return result;
  }

  /**
   * Set a future-dated block that CANNOT be shortened before it expires. The
   * no-shorten guard is a single conditional `updateMany` (write only when the
   * stored value is null or <= the new end), so two concurrent sets can't race a
   * shorter block past a read-then-write check.
   */
  private async extend(
    userId: string,
    field: 'coolOffUntil' | 'selfExcludedUntil',
    until: Date,
    label: string,
  ): Promise<RgState> {
    if (until.getTime() <= Date.now()) {
      throw new BadRequestException(`${label} must be a future date`);
    }
    const updated = await this.prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ [field]: null }, { [field]: { lte: until } }],
      } as Prisma.UserWhereInput,
      data: { [field]: until } as Prisma.UserUpdateManyMutationInput,
    });
    if (updated.count === 0) {
      throw new ForbiddenException(`Cannot shorten an active ${label}`);
    }
    return this.state(userId);
  }
}
