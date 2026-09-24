import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AFFILIATE, GAME_HOUSE_EDGE, type GameType } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { withSerializable } from '../prisma/with-serializable';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { sharesEconomy } from '../custody/economy';

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

/** Parts-per-million, so a fractional edge and rate multiply in exact BigInt maths. */
const PPM = 1_000_000n;

/** A referrer's cut of one wager: stake × house edge(game) × tier rate, floored. */
export function referralCommission(
  stakeLamports: bigint,
  gameType: GameType,
  rate: number,
): bigint {
  const edgePpm = BigInt(Math.round((GAME_HOUSE_EDGE[gameType] ?? 0) * 1_000_000));
  const ratePpm = BigInt(Math.round(rate * 1_000_000));
  return (stakeLamports * edgePpm * ratePpm) / (PPM * PPM);
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
   *
   * Commission = stake × the game's house edge × the referrer's tier rate — a
   * share of what the house expects to KEEP, the way bc.game computes it. It
   * used to be stake × rate: 5-15% of the stake on a 5% game, so a referrer
   * with two referred accounts flipping against each other out-earned the house
   * on every flip, with zero risk.
   */
  async creditReferral(
    tx: Prisma.TransactionClient,
    refereeId: string,
    stakeLamports: bigint,
    gameType: GameType,
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
    // Play-money wagering never earns a deposited referrer commission, nor the
    // reverse (ADR 0005): the volume is still tracked, the commission is 0.
    const earns = !sameIp && (await sharesEconomy(tx, referrerId, refereeId));
    const commission = earns ? referralCommission(stakeLamports, gameType, rate) : 0n;

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
        _sum: { commissionLamports: true, commissionClaimedLamports: true },
      }),
    ]);

    const earned = commissionAgg._sum.commissionLamports ?? BigInt(0);
    const claimed = commissionAgg._sum.commissionClaimedLamports ?? BigInt(0);
    const claimable = earned - claimed;

    return {
      refCode: user.refCode,
      referralCount,
      totalVolumeLamports: (volumeAgg._sum.volumeLamports ?? BigInt(0)).toString(),
      totalCommissionLamports: earned.toString(),
      claimedCommissionLamports: claimed.toString(),
      claimableCommissionLamports: (claimable > BigInt(0) ? claimable : BigInt(0)).toString(),
      referralUrl: `https://scadium.com/?ref=${user.refCode}`,
    };
  }

  /**
   * Claim accrued affiliate commission into the referrer's play balance (#H18).
   * Credits (commissionLamports - commissionClaimedLamports) summed over the
   * user's non-flagged referrals and advances each row's claimed marker to its
   * earned commission, so every lamport of commission is paid at most once.
   * Serializable: a concurrent settlement incrementing commissionLamports on one
   * of these rows conflicts and retries, so the claim never over- or under-pays.
   */
  async claim(userId: string): Promise<{ claimedLamports: string }> {
    return withSerializable(this.prisma, async (tx) => {
      const rows = await tx.referral.findMany({
        where: { referrerId: userId, flagged: false },
        select: { id: true, commissionLamports: true, commissionClaimedLamports: true },
      });
      let claimable = BigInt(0);
      const toAdvance: { id: string; to: bigint }[] = [];
      for (const r of rows) {
        const delta = r.commissionLamports - r.commissionClaimedLamports;
        if (delta > BigInt(0)) {
          claimable += delta;
          toAdvance.push({ id: r.id, to: r.commissionLamports });
        }
      }
      if (claimable <= BigInt(0)) throw new BadRequestException('No commission to claim');

      for (const a of toAdvance) {
        await tx.referral.update({
          where: { id: a.id },
          data: { commissionClaimedLamports: a.to },
        });
      }
      await applyBalanceDelta(tx, userId, claimable, {
        reason: 'affiliate_commission',
        refType: 'Referral',
      });
      return { claimedLamports: claimable.toString() };
    });
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
