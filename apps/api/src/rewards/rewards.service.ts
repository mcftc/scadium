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
    const period = BigInt(Date.now());
    const scope = `reward_claim_${kind}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const replay = await claimIdempotency(tx, userId, scope, key);
      if (replay) {
        return { response: replay as ReturnType<typeof this.serializeClaim>, replayed: true };
      }

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      let amount: bigint;
      if (kind === 'wagerReward') {
        amount = user.scadiumBalance;
        if (amount <= BigInt(0)) throw new BadRequestException('Nothing to claim');
        await tx.user.update({
          where: { id: userId },
          data: { scadiumBalance: { decrement: amount } },
        });
      } else {
        amount = this.cashbackAccrued(user.totalLost, user.cashbackBaselineLost);
        if (amount <= BigInt(0)) throw new BadRequestException('Nothing to claim');
        await tx.user.update({
          where: { id: userId },
          data: { cashbackBaselineLost: user.totalLost },
        });
      }

      const claim = await tx.rewardClaim.create({
        data: { userId, kind, period, amountScad: amount },
      });
      const response = this.serializeClaim(kind, amount, claim.id);
      await storeIdempotency(tx, userId, scope, key, response);
      return {
        response,
        replayed: false,
        chain: { claimId: claim.id, walletAddress: user.walletAddress, amount },
      };
    });

    // Skip the (fire-and-forget) on-chain claim on replay — already fired.
    if (!result.replayed && result.chain) {
      this.fireChainClaim(result.chain.claimId, result.chain.walletAddress, kind, period, result.chain.amount);
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
          resultJson: { tier: tierEntry.tier, ...fair },
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

    if (!result.replayed && result.chain) {
      this.fireChainClaim(
        result.chain.claimId,
        result.chain.walletAddress,
        'dailyCase',
        period,
        result.chain.amount,
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

  private fireChainClaim(
    claimId: string,
    walletAddress: string,
    kind: 'wagerReward' | 'cashback' | 'dailyCase' | 'airdrop',
    period: bigint,
    amount: bigint,
  ): void {
    if (!this.chain.enabled) return;
    void this.chain
      .claimReward({ walletAddress, kind, period, amountScadBase: amount })
      .then(async (sig) => {
        if (sig) {
          await this.prisma.rewardClaim.update({
            where: { id: claimId },
            data: { txSignature: sig },
          });
        }
      })
      .catch((e: unknown) =>
        this.logger.error(`on-chain claim failed for ${claimId}: ${String(e)}`),
      );
  }
}
