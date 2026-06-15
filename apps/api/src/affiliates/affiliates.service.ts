import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AFFILIATE } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Commission rate for a referrer's cumulative referred volume (#47). */
export function tierCommission(referredVolumeLamports: bigint): number {
  const thresholds = AFFILIATE.TIER_THRESHOLDS_LAMPORTS;
  let tier = 0;
  for (let i = thresholds.length - 1; i >= 0; i -= 1) {
    if (referredVolumeLamports >= BigInt(thresholds[i]!)) {
      tier = i;
      break;
    }
  }
  return AFFILIATE.TIER_COMMISSION[tier] ?? AFFILIATE.TIER_COMMISSION[0];
}

/**
 * Affiliate stats + the referral write-path (#47). `creditReferral` runs INSIDE
 * each settlement transaction so a referred user's wagered volume and the
 * referrer's tiered commission accrue atomically and replay-safe (the enclosing
 * settle is idempotent). Same-IP referrer/referee pairs are flagged and accrue
 * volume but NO commission.
 */
@Injectable()
export class AffiliatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Accrue a referred user's stake to their referrer's `Referral` row. No-op if
   * the user has no referrer. MUST be called with the settlement's `tx` client.
   */
  async creditReferral(
    tx: Prisma.TransactionClient,
    refereeId: string,
    stakeLamports: bigint,
  ): Promise<void> {
    if (stakeLamports <= 0n) return;
    const referee = await tx.user.findUnique({
      where: { id: refereeId },
      select: { referredById: true, signupIpHash: true },
    });
    if (!referee?.referredById) return;
    const referrerId = referee.referredById;

    // Tier from the referrer's cumulative referred volume so far.
    const agg = await tx.referral.aggregate({
      where: { referrerId },
      _sum: { volumeLamports: true },
    });
    const rate = tierCommission(agg._sum.volumeLamports ?? 0n);

    // Same-IP sybil: referrer and referee share a signup IP-hash → no commission.
    const referrer = await tx.user.findUnique({
      where: { id: referrerId },
      select: { signupIpHash: true },
    });
    const sameIp = !!referee.signupIpHash && referee.signupIpHash === referrer?.signupIpHash;
    const commission = sameIp
      ? 0n
      : (stakeLamports * BigInt(Math.round(rate * 10_000))) / 10_000n;

    await tx.referral.upsert({
      where: { refereeId },
      create: {
        referrerId,
        refereeId,
        volumeLamports: stakeLamports,
        commissionLamports: commission,
        flagged: sameIp,
      },
      update: {
        volumeLamports: { increment: stakeLamports },
        commissionLamports: { increment: commission },
        ...(sameIp ? { flagged: true } : {}),
      },
    });
  }

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
