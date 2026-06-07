import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RewardsService } from '../rewards/rewards.service';
import { AirdropEngine } from './airdrop.engine';

/**
 * Hourly airdrop pool + eligibility + daily case endpoints. The pool itself
 * (tips, hourly distribution) lives in AirdropEngine; the daily case is a
 * $SCAD reward claim (Phase C) — opening delegates to RewardsService which
 * handles the DB cooldown (User.lastDailyCaseAt), the RewardClaim row and
 * the on-chain claim_reward transfer.
 */
@Injectable()
export class AirdropService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: RewardsService,
    private readonly engine: AirdropEngine,
  ) {}

  async nextDropInfo() {
    const snap = await this.engine.poolSnapshot();
    return {
      nextDropAt: new Date(snap.endsAt).toISOString(),
      intervalMs: 60 * 60 * 1000,
      poolLamports: snap.poolLamports,
    };
  }

  /** Live pool for the left-rail widget. */
  pool() {
    return this.engine.poolSnapshot();
  }

  /** Tip play-balance SOL into the current hour's pool (not refundable). */
  async tip(userId: string, amountLamports: bigint) {
    if (amountLamports <= BigInt(0)) throw new BadRequestException('Tip must be positive');
    try {
      return await this.engine.tip(userId, amountLamports);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Tip failed');
    }
  }

  /** Admin/dev: force the distribution to run now. */
  async forceDistribute(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'admin') throw new ForbiddenException('Admin access required');
    return this.engine.distribute();
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
