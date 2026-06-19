import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SCAD } from '@scadium/shared';
import { dailyCaseRoll, pickCaseTier } from '@scadium/fair';
import { PrismaService } from '../prisma/prisma.service';
import { ChainService } from '../solana/chain.service';
import { SeedManagerService } from '../fairness/seed-manager.service';
import { claimIdempotency, storeIdempotency } from '../prisma/idempotency';

/**
 * $SCAD reward accrual + claims (Phase C).
 *
 * Accrual happens at game settle time (scadiumBalance += wager × rate) and
 * lazily for cashback (delta of totalLost since the last claim baseline).
 * A claim writes the RewardClaim row inside a transaction, then fires the
 * on-chain claim_reward transfer from the rewards treasury — the chain tx
 * is fire-and-forget (sig lands on the row) so the API stays responsive,
 * mirroring how bet settlement works.
 */
@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
    private readonly seeds: SeedManagerService,
  ) {}

  async summary(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const cashback = this.cashbackAccrued(user.totalLost, user.cashbackBaselineLost);
    const nextCaseAt = user.lastDailyCaseAt
      ? user.lastDailyCaseAt.getTime() + 24 * 60 * 60 * 1000
      : 0;
    return {
      wagerClaimableScad: user.scadiumBalance.toString(),
      cashbackClaimableScad: cashback.toString(),
      dailyCase: {
        available: Date.now() >= nextCaseAt,
        nextAvailableAt: Date.now() >= nextCaseAt ? null : new Date(nextCaseAt).toISOString(),
      },
      chainEnabled: this.chain.enabled,
    };
  }

  async claim(userId: string, kind: 'wagerReward' | 'cashback', key?: string) {
    // Custody rule (#28): claiming moves value ON CHAIN — with the chain
    // disabled there is nothing to claim INTO, and the old behaviour silently
    // consumed the balance. Reject instead; accrual keeps accumulating.
    if (!this.chain.enabled) {
      throw new BadRequestException('On-chain claims are disabled on this server');
    }
    const period = BigInt(Date.now());
    const scope = `reward_claim_${kind}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const replay = await claimIdempotency(tx, userId, scope, key);
      if (replay) {
        return { response: replay as ReturnType<typeof this.serializeClaim>, replayed: true };
      }

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      // One pending claim per kind at a time — a second claim while the first
      // is unconfirmed would double-spend the same accrual window.
      const pending = await tx.rewardClaim.count({
        where: { userId, kind, status: 'pending' },
      });
      if (pending > 0) throw new BadRequestException('A claim is already pending confirmation');

      let amount: bigint;
      if (kind === 'wagerReward') {
        amount = user.scadiumBalance;
        if (amount <= BigInt(0)) throw new BadRequestException('Nothing to claim');
        // RESERVE, don't consume (#28): balance → reserved; the debit
        // finalizes on confirm, or the reserve restores on permanent failure.
        await tx.user.update({
          where: { id: userId },
          data: {
            scadiumBalance: { decrement: amount },
            scadiumReserved: { increment: amount },
          },
        });
      } else {
        amount = this.cashbackAccrued(user.totalLost, user.cashbackBaselineLost);
        if (amount <= BigInt(0)) throw new BadRequestException('Nothing to claim');
        // The baseline bump happens at CONFIRM time — until then the accrual
        // window stays intact (a failed claim costs nothing). The pending-claim
        // guard above prevents double-claiming the same window meanwhile.
      }

      const claim = await tx.rewardClaim.create({
        data: { userId, kind, period, amountScad: amount, status: 'pending' },
      });
      const response = this.serializeClaim(kind, amount, claim.id);
      await storeIdempotency(tx, userId, scope, key, response);
      return {
        response,
        replayed: false,
        chain: { claimId: claim.id, walletAddress: user.walletAddress, amount },
      };
    });

    // Immediate attempt for snappy UX; the reconcile worker is the safety net.
    if (!result.replayed && result.chain) {
      void this.attemptChainClaim(result.chain.claimId).catch((e) =>
        this.logger.error(`claim attempt ${result.chain!.claimId} failed: ${String(e)}`),
      );
    }
    return result.response;
  }

  private serializeClaim(
    kind: 'wagerReward' | 'cashback',
    amount: bigint,
    claimId: string,
  ) {
    return { kind, amountScad: amount.toString(), claimId };
  }

  /**
   * Claim accrued USDS dividends on-chain (SCAD Engine). Reservation-based and
   * idempotent, mirroring {@link claim}: `usdsBalance → usdsReserved`, a
   * `RewardClaim(kind='dividend')` row (its `amountScad` column carries the USDS
   * base-unit amount), then the on-chain `claim_dividend` transfer. The reserve
   * finalizes on confirm or restores on permanent failure.
   */
  async claimDividend(userId: string, key?: string) {
    if (!this.chain.enabled) {
      throw new BadRequestException('On-chain claims are disabled on this server');
    }
    const period = BigInt(Date.now());
    const scope = 'reward_claim_dividend';

    const result = await this.prisma.$transaction(async (tx) => {
      const replay = await claimIdempotency(tx, userId, scope, key);
      if (replay) {
        return { response: replay as { kind: string; amountUsds: string; claimId: string }, replayed: true };
      }
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      const pending = await tx.rewardClaim.count({
        where: { userId, kind: 'dividend', status: 'pending' },
      });
      if (pending > 0) throw new BadRequestException('A claim is already pending confirmation');

      const amount = user.usdsBalance;
      if (amount <= BigInt(0)) throw new BadRequestException('Nothing to claim');
      await tx.user.update({
        where: { id: userId },
        data: { usdsBalance: { decrement: amount }, usdsReserved: { increment: amount } },
      });

      const claim = await tx.rewardClaim.create({
        data: { userId, kind: 'dividend', period, amountScad: amount, status: 'pending' },
      });
      const response = { kind: 'dividend', amountUsds: amount.toString(), claimId: claim.id };
      await storeIdempotency(tx, userId, scope, key, response);
      return {
        response,
        replayed: false,
        chain: { claimId: claim.id, walletAddress: user.walletAddress, amount },
      };
    });

    if (!result.replayed && result.chain) {
      void this.attemptChainClaim(result.chain.claimId).catch((e) =>
        this.logger.error(`dividend claim attempt ${result.chain!.claimId} failed: ${String(e)}`),
      );
    }
    return result.response;
  }

  /** Daily case: weighted SCAD prize, one per 24h (DB cooldown + on-chain PDA). */
  async openDailyCase(userId: string, key?: string) {
    const now = new Date();
    // Period = YYYYMMDD so the on-chain ClaimRecord enforces one per day too.
    const period = BigInt(
      now.getUTCFullYear() * 10_000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate(),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const replay = await claimIdempotency(tx, userId, 'daily_case', key);
      if (replay) {
        return { response: replay as ReturnType<typeof this.serializeDailyCase>, replayed: true };
      }

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      const last = user.lastDailyCaseAt?.getTime() ?? 0;
      if (Date.now() - last < 24 * 60 * 60 * 1000) {
        throw new BadRequestException(
          `Daily case already opened. Next: ${new Date(last + 24 * 60 * 60 * 1000).toISOString()}`,
        );
      }

      // Provably-fair tier (#22): derive from the player's active seed pair +
      // monotonic nonce — committed long before this request, so neither side
      // can grind the prize. Consumed AFTER the cooldown check so a rejected
      // open doesn't burn a nonce; the tier reproduces via @scadium/fair once
      // the server seed is revealed on rotation (same model as every game).
      const ctx = await this.seeds.consumeNonce(tx, userId);
      const nonce = Number(ctx.nonce);
      const roll = dailyCaseRoll(ctx.serverSeed, ctx.clientSeed, nonce);
      const tierEntry = pickCaseTier(roll, SCAD.CASE_TIERS);
      const amount = BigInt(tierEntry.scadBase);
      const fair = {
        roll,
        serverSeedHash: ctx.serverSeedHash,
        clientSeed: ctx.clientSeed,
        nonce,
      };

      await tx.user.update({ where: { id: userId }, data: { lastDailyCaseAt: now } });
      const claim = await tx.rewardClaim.create({
        data: {
          userId,
          kind: 'dailyCase',
          period,
          amountScad: amount,
          // roll as a STRING (#128): jsonb's numeric round-trip drops the last
          // ULP on 17-significant-digit doubles, breaking exact reproduction of
          // the trail from the revealed seed. Same policy as lamports.
          resultJson: { tier: tierEntry.tier, ...fair, roll: roll.toString() },
          // #28: with the chain ON the prize is a pending on-chain transfer;
          // OFF it is an explicit non-value record (demo experience) — never
          // presented as a paid claim.
          status: this.chain.enabled ? 'pending' : 'offchain',
        },
      });
      const response = this.serializeDailyCase(tierEntry.tier, amount, now, fair);
      await storeIdempotency(tx, userId, 'daily_case', key, response);
      return {
        response,
        replayed: false,
        chain: { claimId: claim.id, walletAddress: user.walletAddress, amount },
      };
    });

    if (!result.replayed && result.chain && this.chain.enabled) {
      void this.attemptChainClaim(result.chain.claimId).catch((e: unknown) =>
        this.logger.error(`daily-case claim attempt failed: ${String(e)}`),
      );
    }
    return result.response;
  }

  private serializeDailyCase(
    tier: string,
    amount: bigint,
    now: Date,
    fair: { roll: number; serverSeedHash: string; clientSeed: string; nonce: number },
  ) {
    return {
      tier,
      rewardScad: amount.toString(),
      nextAvailableAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      fair,
    };
  }

  async recentClaims(userId: string, limit = 20) {
    const rows = await this.prisma.rewardClaim.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amountScad: r.amountScad.toString(),
      txSignature: r.txSignature,
      // Fairness trail for dailyCase rows (#22) — lets a player who lost the
      // open response still verify the tier after rotating their server seed.
      resultJson: r.resultJson,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ------------------------------------------------------------- helpers

  private cashbackAccrued(totalLost: bigint, baseline: bigint): bigint {
    const delta = totalLost - baseline;
    if (delta <= BigInt(0)) return BigInt(0);
    return delta * BigInt(SCAD.CASHBACK_PER_LAMPORT_LOST);
  }

  /** Attempts before a pending claim is declared failed and its reserve restored. */
  static readonly MAX_CLAIM_ATTEMPTS = 5;

  /**
   * One on-chain attempt for a PENDING claim (#28), transitioning the full
   * lifecycle atomically. Idempotent: the status-guarded update means a
   * concurrent attempt (API immediate + worker sweep) finalizes at most once —
   * and on chain the ClaimRecord PDA (user, kind, period) blocks double-pays.
   *
   * confirmed → txSignature set + debit finalized (wagerReward: reserve burned;
   *             cashback: baseline bumped).
   * failed    → after MAX_CLAIM_ATTEMPTS: wagerReward reserve RESTORED to the
   *             spendable balance; cashback/dailyCase need no restore (their
   *             accrual/cooldown was never consumed).
   */
  async attemptChainClaim(claimId: string): Promise<'confirmed' | 'failed' | 'pending' | 'skipped'> {
    if (!this.chain.enabled) return 'skipped';
    const claim = await this.prisma.rewardClaim.findUnique({
      where: { id: claimId },
      include: { user: { select: { walletAddress: true, totalLost: true } } },
    });
    if (!claim || claim.status !== 'pending') return 'skipped';

    const sig =
      claim.kind === 'dividend'
        ? await this.chain.claimDividend({
            walletAddress: claim.user.walletAddress,
            period: claim.period,
            // amountScad carries the USDS base-unit amount for dividend rows.
            amountUsdsBase: claim.amountScad,
          })
        : await this.chain.claimReward({
            walletAddress: claim.user.walletAddress,
            kind: claim.kind as 'wagerReward' | 'cashback' | 'dailyCase' | 'airdrop',
            period: claim.period,
            amountScadBase: claim.amountScad,
          });

    if (sig) {
      await this.prisma.$transaction(async (tx) => {
        // Status-guarded: only ONE attempt may flip pending → confirmed.
        const flipped = await tx.rewardClaim.updateMany({
          where: { id: claim.id, status: 'pending' },
          data: { status: 'confirmed', txSignature: sig },
        });
        if (flipped.count === 0) return; // raced — the other attempt finalizes
        if (claim.kind === 'wagerReward') {
          await tx.user.update({
            where: { id: claim.userId },
            data: { scadiumReserved: { decrement: claim.amountScad } },
          });
        } else if (claim.kind === 'cashback') {
          await tx.user.update({
            where: { id: claim.userId },
            data: { cashbackBaselineLost: claim.user.totalLost },
          });
        } else if (claim.kind === 'dividend') {
          await tx.user.update({
            where: { id: claim.userId },
            data: { usdsReserved: { decrement: claim.amountScad } },
          });
        }
      });
      return 'confirmed';
    }

    // Transient failure — count it; past the budget, fail + restore.
    const attempts = claim.attempts + 1;
    if (attempts < RewardsService.MAX_CLAIM_ATTEMPTS) {
      await this.prisma.rewardClaim.update({
        where: { id: claim.id },
        data: { attempts },
      });
      return 'pending';
    }
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.rewardClaim.updateMany({
        where: { id: claim.id, status: 'pending' },
        data: { status: 'failed', attempts },
      });
      if (flipped.count === 0) return;
      if (claim.kind === 'wagerReward') {
        await tx.user.update({
          where: { id: claim.userId },
          data: {
            scadiumReserved: { decrement: claim.amountScad },
            scadiumBalance: { increment: claim.amountScad },
          },
        });
      } else if (claim.kind === 'dividend') {
        await tx.user.update({
          where: { id: claim.userId },
          data: {
            usdsReserved: { decrement: claim.amountScad },
            usdsBalance: { increment: claim.amountScad },
          },
        });
      }
    });
    this.logger.error(
      `reward claim ${claim.id} (${claim.kind}) failed permanently after ${attempts} attempts — reserve restored`,
    );
    return 'failed';
  }

  /**
   * Reconcile worker entrypoint (#28): sweep PENDING claims (oldest first) and
   * attempt each. Returns the number processed. Safe to run from N workers —
   * every transition is status-guarded and the on-chain ClaimRecord PDA is the
   * double-pay backstop.
   */
  async reconcilePendingClaims(limit = 50): Promise<number> {
    if (!this.chain.enabled) return 0;
    const pending = await this.prisma.rewardClaim.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const c of pending) {
      await this.attemptChainClaim(c.id).catch((e: unknown) =>
        this.logger.error(`reconcile claim ${c.id} failed: ${String(e)}`),
      );
    }
    return pending.length;
  }
}
