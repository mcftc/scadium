import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Admin read-only statistics and user moderation.
 * All methods assert the caller has the admin role — the controller does
 * this via JwtAuthGuard + a role check (kept inline for simplicity; move
 * to a RolesGuard once we have more role-based logic).
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'admin') throw new ForbiddenException('Admin access required');
  }

  async platformStats() {
    const [userCount, betCount, wagerAgg, payoutAgg, chatCount, recentUsers] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.bet.count(),
      this.prisma.bet.aggregate({ _sum: { amountLamports: true } }),
      this.prisma.bet.aggregate({ _sum: { payoutLamports: true } }),
      this.prisma.chatMessage.count(),
      this.prisma.user.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    const totalWagered = wagerAgg._sum.amountLamports ?? BigInt(0);
    const totalPayout = payoutAgg._sum.payoutLamports ?? BigInt(0);
    const houseProfit = totalWagered - totalPayout;

    return {
      users: userCount,
      newUsers24h: recentUsers,
      betsTotal: betCount,
      volumeLamports: totalWagered.toString(),
      payoutsLamports: totalPayout.toString(),
      houseProfitLamports: houseProfit.toString(),
      chatMessages: chatCount,
    };
  }

  async banUser(targetId: string, reason?: string) {
    await this.prisma.user.update({
      where: { id: targetId },
      data: { banned: true, banReason: reason ?? 'Banned by admin' },
    });
  }

  async unbanUser(targetId: string) {
    await this.prisma.user.update({
      where: { id: targetId },
      data: { banned: false, banReason: null },
    });
  }
}
