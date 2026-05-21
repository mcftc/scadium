import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAILY_CASE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Airdrop + daily case. Since we're not yet on-chain, the "airdrop" is a
 * play-money credit to the user's balance. Once Solana programs ship
 * this becomes a vault-funded token transfer.
 */
@Injectable()
export class AirdropService {
  private readonly logger = new Logger(AirdropService.name);
  // Track last case claim per user in memory for simplicity. Moves to a
  // DB column when we care about cross-instance consistency.
  private readonly lastCaseClaim = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const last = this.lastCaseClaim.get(userId) ?? 0;
    const now = Date.now();
    if (now - last < DAILY_CASE_INTERVAL_MS) {
      const availableAt = new Date(last + DAILY_CASE_INTERVAL_MS).toISOString();
      throw new BadRequestException(`Daily case already opened. Next: ${availableAt}`);
    }

    // Weighted reward table: mostly small, rare jackpot
    const roll = Math.random();
    let rewardLamports = BigInt(0);
    let tier = '';
    if (roll < 0.001) {
      rewardLamports = BigInt(1_000_000_000); // 1 SOL — 0.1%
      tier = 'legendary';
    } else if (roll < 0.01) {
      rewardLamports = BigInt(100_000_000); // 0.1 SOL — 1%
      tier = 'epic';
    } else if (roll < 0.1) {
      rewardLamports = BigInt(10_000_000); // 0.01 SOL — 10%
      tier = 'rare';
    } else {
      rewardLamports = BigInt(1_000_000); // 0.001 SOL — ~89%
      tier = 'common';
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { playBalanceLamports: { increment: rewardLamports } },
    });
    this.lastCaseClaim.set(userId, now);

    return {
      tier,
      rewardLamports: rewardLamports.toString(),
      nextAvailableAt: new Date(now + DAILY_CASE_INTERVAL_MS).toISOString(),
    };
  }

  async caseStatus(userId: string) {
    const last = this.lastCaseClaim.get(userId) ?? 0;
    const nextAt = last + DAILY_CASE_INTERVAL_MS;
    const available = Date.now() >= nextAt;
    return {
      available,
      nextAvailableAt: available ? null : new Date(nextAt).toISOString(),
    };
  }
}
