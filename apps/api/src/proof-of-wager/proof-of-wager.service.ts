import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type GameType, type WagerCampaign } from '@prisma/client';
import { LAMPORTS_PER_SOL, WAGER, emissionPhaseFor } from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';

/** The fixed id of the singleton EmissionState row (see schema). */
const EMISSION_SINGLETON_ID = 'singleton';

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

  // --- Emission counter: cache + write-buffer (mirrors campaignCache) ---------
  // accrue() runs in EVERY game settlement. Touching the singleton EmissionState
  // row per bet (a read + an upsert on `this.prisma`, separate connections from
  // the settle tx) exhausts the Prisma connection pool under load — 50 concurrent
  // crash bets then can't get a connection (chaos/balance-race). So emission is
  // NEVER touched per bet:
  //   • cachedEmitted — the persisted total, refreshed from ONE read at most once
  //     per CACHE_TTL_MS.
  //   • pendingEmitted — in-memory sum of mints since the last flush. accrue adds
  //     to this with NO DB write.
  // The phase/cap each use `cachedEmitted + pendingEmitted`. On the next refresh
  // (TTL elapsed) we FLUSH pendingEmitted to the DB in a single upsert, reset it,
  // and re-read the persisted total. So emission hits the DB ~once per TTL window,
  // never per bet. The counter is an APPROXIMATE phase cursor (buffered/flushed);
  // the exact issued $SCAD is the in-tx applyBalanceDelta('scad') ledger credit,
  // which stays the source of truth and keeps scadLedgerDrift zero.
  private cachedEmitted = 0n;
  private cachedEmittedAt = 0;
  private pendingEmitted = 0n;
  // Coalesces concurrent cache refreshes into ONE DB round-trip: a cold-cache
  // burst (e.g. 50 bets settling at once) would otherwise each fire its own
  // `this.prisma` read and exhaust the connection pool — the exact regression.
  // While a refresh is in flight, every other accrue awaits the same promise.
  private emissionRefresh: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Effective cumulative emission = persisted (cached) total + the unflushed
   * in-memory buffer. Refreshes the cache (single read + buffer flush) when the
   * TTL has elapsed, or on first use (`cachedEmittedAt === 0`). Returns the value
   * accrue() uses to pick the halving phase and the remaining-pool cap — with NO
   * per-bet DB op once the cache is warm.
   */
  private async effectiveEmitted(): Promise<bigint> {
    const now = Date.now();
    const stale =
      this.cachedEmittedAt === 0 || now - this.cachedEmittedAt > ProofOfWagerService.CACHE_TTL_MS;
    if (stale) {
      // Coalesce: only the FIRST caller starts the refresh; concurrent callers
      // (a cold-cache settlement burst) await the same in-flight promise, so the
      // pool sees ONE connection acquisition, never one-per-bet.
      if (!this.emissionRefresh) {
        this.emissionRefresh = this.refreshEmission(now).finally(() => {
          this.emissionRefresh = null;
        });
      }
      await this.emissionRefresh;
    }
    return this.cachedEmitted + this.pendingEmitted;
  }

  /** Single DB round-trip: flush the buffer, then re-read the persisted total. */
  private async refreshEmission(now: number): Promise<void> {
    try {
      // FLUSH the buffered increments in a single upsert (atomic increment, READ
      // COMMITTED) — decoupled from any serializable settle so it never makes
      // concurrent settles abort. Upsert so a fresh DB self-heals the singleton.
      if (this.pendingEmitted > 0n) {
        const flush = this.pendingEmitted;
        await this.prisma.emissionState.upsert({
          where: { id: EMISSION_SINGLETON_ID },
          create: { id: EMISSION_SINGLETON_ID, totalEmittedScad: flush },
          update: { totalEmittedScad: { increment: flush } },
        });
        // Only clear what we flushed; concurrent accrues may have added more.
        this.pendingEmitted -= flush;
      }
      // Re-read the persisted total into the cache (single read).
      const row = await this.prisma.emissionState.findUnique({
        where: { id: EMISSION_SINGLETON_ID },
      });
      this.cachedEmitted = row?.totalEmittedScad ?? 0n;
      this.cachedEmittedAt = now;
    } catch (e) {
      this.logger.warn(
        `emission cache refresh/flush failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Test seam: force the next emission read to be fresh (used after seeding
   * EmissionState directly). Clears the cache timestamp AND the in-memory buffer
   * so the seeded persisted value is read immediately and no stale mint leaks
   * across tests. No-op in production paths.
   */
  __resetEmissionCacheForTest(): void {
    this.cachedEmitted = 0n;
    this.cachedEmittedAt = 0;
    this.pendingEmitted = 0n;
  }

  /**
   * Test seam: force the buffered emission to flush to EmissionState NOW (the
   * production path flushes lazily, once per TTL). Expires the cache timestamp
   * WITHOUT dropping the buffer, then runs the refresh — so the persisted row
   * reflects every buffered mint and a subsequent direct DB read is exact.
   */
  async __flushEmissionForTest(): Promise<bigint> {
    this.cachedEmittedAt = 0; // expire only; keep pendingEmitted so it flushes
    return this.effectiveEmitted();
  }

  /**
   * Accrue $SCAD for one settled wager. MUST be called on the caller's
   * transaction client so the credit + leaderboard write commit (or roll back)
   * atomically with the rest of the settlement. Returns the SCAD base units
   * credited (callers may ignore it).
   */
  async accrue(tx: Prisma.TransactionClient, params: AccrueParams): Promise<bigint> {
    const { userId, stakeLamports } = params;
    if (stakeLamports <= 0n) return 0n;

    // Engine v2 (E3): $SCAD is NO LONGER minted per bet. The hourly block worker
    // (BlockMiningService) is the single emission authority — it mints each
    // hour's halving-phase block reward split by PLAY-RATE. accrue() now only
    // records wager VOLUME into the daily + weekly leaderboard buckets, which
    // ALSO feed the play-rate the block split reads. It stays on the settlement
    // tx (and in the engine-coverage contract) so every game remains wired into
    // the engine; it just no longer credits a balance. Returns 0n (callers
    // ignore the result).
    const { daily, weekly } = periodKeys(new Date());
    for (const period of [daily, weekly]) {
      await tx.wagerLeaderboard.upsert({
        where: { period_userId: { period, userId } },
        create: { period, userId, wageredLamports: stakeLamports },
        update: { wageredLamports: { increment: stakeLamports } },
      });
    }

    return 0n;
  }

  /**
   * The combined accrual multiplier actually applied by `accrue()`:
   * `min(tier × campaign, MAX_MULTIPLIER)`. Pure (no I/O) so it can be reused by
   * the earn-rate readout (#205) AND `accrue()` without duplicating the tier/cap
   * math. `campaignMult` defaults to 1.0 (no active campaign).
   */
  effectiveMultiplier(lifetimeWagered: bigint, campaignMult = 1.0): number {
    const tierMult = this.tierMultiplier(lifetimeWagered);
    return Math.min(tierMult * campaignMult, WAGER.MAX_MULTIPLIER);
  }

  /**
   * Read-only earn-rate readout for a user (#205 — DISPLAY ONLY, never credits).
   * Surfaces the same multiplier `accrue()` would apply right now, the base
   * per-lamport rate, and the derived "$SCAD per 1 SOL wagered" headline.
   */
  async earnRate(userId: string, gameType?: GameType) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totalWagered: true },
    });
    const campaignMult = await this.campaignMultiplier(this.prisma as never, gameType ?? null);
    const lifetimeWagered = user?.totalWagered ?? 0n;
    const tierMult = this.tierMultiplier(lifetimeWagered);
    const multiplier = this.effectiveMultiplier(lifetimeWagered, campaignMult);

    // Use the CURRENT halving phase's rate so the readout matches what accrue()
    // would actually mint right now (not the fixed phase-1 alias).
    const emitted = await this.totalEmitted();
    const { ratePerLamport } = emissionPhaseFor(emitted);

    // $SCAD base units earned per 1 SOL (1e9 lamports) wagered at this multiplier.
    // base = LAMPORTS_PER_SOL × ratePerLamport; scale the float multiplier to an
    // integer (3 dp) then divide — BigInt-safe, matches accrue.
    const base = BigInt(LAMPORTS_PER_SOL) * BigInt(ratePerLamport);
    const scaled = BigInt(Math.round(multiplier * 1000));
    const scadPerSol = (base * scaled) / 1000n;

    return {
      baseRewardPerLamport: ratePerLamport,
      tierMultiplier: tierMult,
      campaignMultiplier: campaignMult,
      effectiveMultiplier: multiplier,
      scadPerSolWagered: scadPerSol.toString(),
    };
  }

  /**
   * Cumulative $SCAD (base units) emitted by proof-of-wager so far: persisted
   * (cached) total + the unflushed in-memory buffer, so /token/stats and the
   * earn-rate readout reflect mints not yet flushed to EmissionState. Read-only;
   * refreshes the cache when stale (flushing the buffer) but never mints. Returns
   * 0n on a fresh DB with no accruals yet.
   */
  async totalEmitted(): Promise<bigint> {
    return this.effectiveEmitted();
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
    gameType: GameType | null,
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
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  const weekly = `weekly:${date.getUTCFullYear()}${String(week).padStart(2, '0')}`;
  return { daily, weekly };
}
