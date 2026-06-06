import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SCAD } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ChainService } from '../solana/chain.service';

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

  async claim(userId: string, kind: 'wagerReward' | 'cashback') {
    const period = BigInt(Date.now());

    const { amount, walletAddress, claimId } = await this.prisma.$transaction(async (tx) => {
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
      return { amount, walletAddress: user.walletAddress, claimId: claim.id };
    });

    this.fireChainClaim(claimId, walletAddress, kind, period, amount);
    return { kind, amountScad: amount.toString(), claimId };
  }

  /** Daily case: weighted SCAD prize, one per 24h (DB cooldown + on-chain PDA). */
  async openDailyCase(userId: string) {
    const now = new Date();
    // Period = YYYYMMDD so the on-chain ClaimRecord enforces one per day too.
    const period = BigInt(
      now.getUTCFullYear() * 10_000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate(),
    );

    const roll = Math.random();
    const tierEntry =
      SCAD.CASE_TIERS.find((t) => roll < t.chance) ?? SCAD.CASE_TIERS[SCAD.CASE_TIERS.length - 1]!;
    const amount = BigInt(tierEntry.scadBase);

    const { walletAddress, claimId } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      const last = user.lastDailyCaseAt?.getTime() ?? 0;
      if (Date.now() - last < 24 * 60 * 60 * 1000) {
        throw new BadRequestException(
          `Daily case already opened. Next: ${new Date(last + 24 * 60 * 60 * 1000).toISOString()}`,
        );
      }
      await tx.user.update({ where: { id: userId }, data: { lastDailyCaseAt: now } });
      const claim = await tx.rewardClaim.create({
        data: { userId, kind: 'dailyCase', period, amountScad: amount },
      });
      return { walletAddress: user.walletAddress, claimId: claim.id };
    });

    this.fireChainClaim(claimId, walletAddress, 'dailyCase', period, amount);
    return {
      tier: tierEntry.tier,
      rewardScad: amount.toString(),
      nextAvailableAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
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
