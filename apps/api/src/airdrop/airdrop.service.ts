import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RewardsService } from '../rewards/rewards.service';

/**
 * Hourly airdrop eligibility + daily case endpoints. The daily case is a
 * $SCAD reward claim (Phase C) — opening delegates to RewardsService which
 * handles the DB cooldown (User.lastDailyCaseAt), the RewardClaim row and
 * the on-chain claim_reward transfer.
 */
@Injectable()
export class AirdropService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: RewardsService,
  ) {}

  async nextDropInfo() {
    // Next hour-boundary
    const now = Date.now();
    const nextHour = Math.ceil(now / (60 * 60 * 1000)) * (60 * 60 * 1000);
    return {
      nextDropAt: new Date(nextHour).toISOString(),
      intervalMs: 60 * 60 * 1000,
      poolLamports: '1000000000', // 1 SOL demo pool
    };
  }

  async checkEligibility(userId: string) {
    // Eligibility = >= 0.001 SOL wagered in the past hour + at least 1 chat msg
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [wagerSum, chatCount] = await Promise.all([
      this.prisma.bet.aggregate({
        where: { userId, createdAt: { gte: hourAgo } },
        _sum: { amountLamports: true },
      }),
      this.prisma.chatMessage.count({
        where: { userId, createdAt: { gte: hourAgo } },
      }),
    ]);
    const wagered = wagerSum._sum.amountLamports ?? BigInt(0);
    return {
      wageredLamports: wagered.toString(),
      chatMessages: chatCount,
      eligible: wagered >= BigInt(1_000_000) && chatCount > 0,
    };
  }

  async openDailyCase(userId: string) {
    return this.rewards.openDailyCase(userId);
  }

  async caseStatus(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const last = user?.lastDailyCaseAt?.getTime() ?? 0;
    const nextAt = last + 24 * 60 * 60 * 1000;
    const available = Date.now() >= nextAt;
    return {
      available,
      nextAvailableAt: available ? null : new Date(nextAt).toISOString(),
    };
  }
}
