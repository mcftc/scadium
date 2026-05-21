import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Affiliate stats for the current user. The Referral rows are populated
 * whenever a user signs up with `?ref=XXX` on the frontend (the web app
 * passes the code into a future /auth endpoint — for now referral wiring
 * on the write side is minimal, so the dashboard reads what's there.)
 */
@Injectable()
export class AffiliatesService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { refCode: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [referralCount, volumeAgg, commissionAgg] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId: userId } }),
      this.prisma.referral.aggregate({
        where: { referrerId: userId },
        _sum: { volumeLamports: true },
      }),
      this.prisma.referral.aggregate({
        where: { referrerId: userId },
        _sum: { commissionLamports: true },
      }),
    ]);

    return {
      refCode: user.refCode,
      referralCount,
      totalVolumeLamports: (volumeAgg._sum.volumeLamports ?? BigInt(0)).toString(),
      totalCommissionLamports: (commissionAgg._sum.commissionLamports ?? BigInt(0)).toString(),
      referralUrl: `https://scadium.io/?ref=${user.refCode}`,
    };
  }

  async recentReferrals(userId: string, limit = 20) {
    const rows = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        referee: { select: { id: true, username: true, walletAddress: true, createdAt: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      volumeLamports: r.volumeLamports.toString(),
      commissionLamports: r.commissionLamports.toString(),
      referee: {
        id: r.referee.id,
        username: r.referee.username,
        walletAddress: r.referee.walletAddress,
        joinedAt: r.referee.createdAt.toISOString(),
      },
    }));
  }
}
