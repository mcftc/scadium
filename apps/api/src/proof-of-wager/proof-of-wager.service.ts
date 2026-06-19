import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type GameType, type WagerCampaign } from '@prisma/client';
import { SCAD, WAGER } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface AccrueParams {
  userId: string;
  gameType: GameType;
  /** Lamports wagered on this settlement (the stake). */
  stakeLamports: bigint;
  /** Originating Bet id, for the ledger/audit trail (optional). */
  betId?: string | null;
}

/**
 * Central "Proof-of-Wager" accrual: the single place that converts a wager into
 * earned $SCAD. Previously every game engine inlined
 * `scadiumBalance += stake × SCAD.WAGER_REWARD_PER_LAMPORT`; this service owns
 * that math plus the campaign/lifetime-tier multipliers and the wager
 * leaderboard, so new games get rewards + leaderboards "for free" by calling
 * `accrue()` inside their settlement transaction.
 *
 * $SCAD is the REDEEMABLE currency; it is only ever CREDITED here (earned by
 * playing) and never debited for wagers — that separation is what keeps the
 * sweepstakes model intact (bought Jeton can never become $SCAD).
 */
@Injectable()
export class ProofOfWagerService {
  private readonly logger = new Logger(ProofOfWagerService.name);

  // Active-campaign cache — campaigns change rarely but accrue() runs on the
  // hot settlement path (crash can settle many bets per tick), so we avoid a
  // per-bet query by caching for CACHE_TTL_MS.
  private campaignCache: WagerCampaign[] = [];
  private campaignCacheAt = 0;
  private static readonly CACHE_TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Accrue $SCAD for one settled wager. MUST be called on the caller's
   * transaction client so the credit + leaderboard write commit (or roll back)
   * atomically with the rest of the settlement. Returns the SCAD base units
   * credited (callers may ignore it).
   */
  async accrue(tx: Prisma.TransactionClient, params: AccrueParams): Promise<bigint> {
    const { userId, gameType, stakeLamports } = params;
    if (stakeLamports <= 0n) return 0n;

    const base = stakeLamports * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT);

    // Lifetime-wager tier multiplier. Read inside the tx; the engine bumps
    // totalWagered before calling accrue, so this reflects the post-wager total
    // (tier-boundary rounding is negligible).
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { totalWagered: true },
    });
    const tierMult = this.tierMultiplier(user?.totalWagered ?? 0n);
    const campaignMult = await this.campaignMultiplier(tx, gameType);
    const multiplier = Math.min(tierMult * campaignMult, WAGER.MAX_MULTIPLIER);

    // BigInt-safe: scale the float multiplier to an integer (3 dp) then divide.
    const scaled = BigInt(Math.round(multiplier * 1000));
    const amount = (base * scaled) / 1000n;
    if (amount <= 0n) return 0n;

    await tx.user.update({
      where: { id: userId },
      data: { scadiumBalance: { increment: amount } },
    });

    // Roll the wager into the daily + weekly leaderboard buckets.
    const { daily, weekly } = periodKeys(new Date());
    for (const period of [daily, weekly]) {
      await tx.wagerLeaderboard.upsert({
        where: { period_userId: { period, userId } },
        create: { period, userId, wageredLamports: stakeLamports },
        update: { wageredLamports: { increment: stakeLamports } },
      });
    }

    return amount;
  }

  /** Lifetime-wager → permanent accrual multiplier (WAGER tiers). */
  private tierMultiplier(lifetimeWagered: bigint): number {
    const thresholds = WAGER.TIER_THRESHOLDS_LAMPORTS;
    let mult: number = WAGER.TIER_MULTIPLIER[0];
    for (let i = 0; i < thresholds.length; i += 1) {
      if (lifetimeWagered >= BigInt(thresholds[i]!)) {
        mult = WAGER.TIER_MULTIPLIER[i] ?? mult;
      }
    }
    return mult;
  }

  /** Highest applicable active-campaign multiplier (campaigns do not stack). */
  private async campaignMultiplier(
    tx: Prisma.TransactionClient,
    gameType: GameType,
  ): Promise<number> {
    const now = Date.now();
    if (now - this.campaignCacheAt > ProofOfWagerService.CACHE_TTL_MS) {
      try {
        this.campaignCache = await tx.wagerCampaign.findMany({
          where: { active: true },
        });
        this.campaignCacheAt = now;
      } catch (err) {
        this.logger.warn(`campaign cache refresh failed: ${String(err)}`);
      }
    }
    const nowDate = new Date(now);
    let best = 1.0;
    for (const c of this.campaignCache) {
      if (!c.active) continue;
      if (c.startsAt > nowDate || c.endsAt < nowDate) continue;
      if (c.gameType !== null && c.gameType !== gameType) continue;
      if (c.multiplier > best) best = c.multiplier;
    }
    return best;
  }

  /** Top wagerers for a period key (e.g. 'daily:YYYYMMDD'). Read-only. */
  async leaderboard(period: string, limit = 50) {
    return this.prisma.wagerLeaderboard.findMany({
      where: { period },
      orderBy: { wageredLamports: 'desc' },
      take: limit,
      include: { user: { select: { username: true, walletAddress: true, avatarUrl: true } } },
    });
  }

  /** Current daily/weekly period keys — exposed for controllers/jobs. */
  currentPeriods() {
    return periodKeys(new Date());
  }
}

/** UTC daily key + ISO-week weekly key for leaderboard bucketing. */
export function periodKeys(now: Date): { daily: string; weekly: string } {
  const y = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const daily = `daily:${y}${mm}${dd}`;

  const date = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  const weekly = `weekly:${date.getUTCFullYear()}${String(week).padStart(2, '0')}`;
  return { daily, weekly };
}
