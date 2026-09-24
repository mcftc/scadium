import { BadRequestException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { lastCompletedHourPeriod, periodForHour } from '../queue/queue.constants';
import { RgService } from '../responsible-gambling/rg.service';
import { AirdropGateway } from './airdrop.gateway';
import { assertPlayOnly, promotionRecipients, stillPlay } from '../custody/economy';

/**
 * Hourly airdrop pool engine (solpump left-rail widget). Each hour has one
 * `AirdropPool` row (period = YYYYMMDDHH UTC) seeded with a base amount and
 * grown by user tips. At the top of the hour the pool is split equally among
 * eligible users (wagered ≥ 0.001 SOL AND chatted in that hour), credited to
 * play balances, and recorded as an AirdropEvent + AirdropClaim rows.
 */
@Injectable()
export class AirdropEngine implements OnModuleInit {
  private readonly logger = new Logger(AirdropEngine.name);

  /** Pool seed per hour — dev default 0.05 SOL, override via env. */
  private readonly baseLamports = BigInt(
    process.env.AIRDROP_BASE_LAMPORTS ?? 50_000_000,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AirdropGateway,
    private readonly rg: RgService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Hourly distribution runs in @scadium/worker now (BullMQ). The API only
    // ensures the current pool row exists for the live widget / tipping.
    await this.ensureCurrentPool();
  }

  /** Period key for the hour containing `ms` (UTC, YYYYMMDDHH). Shared with the
   *  queue jobId so the engine and the dedupe'd job always agree on the hour. */
  private periodFor(ms: number): string {
    return periodForHour(ms);
  }

  /** Epoch ms of the next top-of-hour boundary. */
  private nextBoundary(): number {
    return Math.ceil(Date.now() / 3_600_000) * 3_600_000;
  }

  private async ensureCurrentPool() {
    const period = this.periodFor(Date.now());
    return this.prisma.airdropPool.upsert({
      where: { period },
      update: {},
      create: { period, baseLamports: this.baseLamports },
    });
  }

  /** Current pool snapshot for GET /airdrop/pool and the widget. */
  async poolSnapshot() {
    const pool = await this.ensureCurrentPool();
    return {
      period: pool.period,
      poolLamports: (pool.baseLamports + pool.tipLamports).toString(),
      tipsCount: pool.tipsCount,
      endsAt: this.nextBoundary(),
    };
  }

  /**
   * Tip into the current pool: debit the tipper's play balance atomically
   * and grow the pool. Mirrors solpump's "your tip will be added to the
   * Airdrop — this action is not refundable".
   */
  async tip(userId: string, amountLamports: bigint) {
    // Defense-in-depth: reject non-positive tips at the engine boundary so this
    // method is safe regardless of caller. A negative amount with the
    // `{ decrement }` write below would INCREMENT the tipper's balance and
    // drive the pool negative (ANALYSIS.md §4 Critical #1). The controller DTO
    // and AirdropService also guard; the DB CHECK is the final backstop.
    if (amountLamports <= 0n) throw new BadRequestException('Tip must be positive');
    // Self-excluded / cooling-off users cannot move money into the pool either.
    await this.rg.assertCanWager(userId, 0n);
    const period = this.periodFor(Date.now());
    const pool = await this.ensureCurrentPool();
    // Guard against tipping into an already-settled pool (only reachable when
    // a distribution was forced mid-hour in dev) — the tip would be stranded.
    if (pool.distributed) throw new Error('This hour’s pool already settled — try after the hour');
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found');
      // The pool is a play-money promotion: deposited SOL never goes in (ADR 0005).
      await assertPlayOnly(tx, userId, 'Tipping the airdrop');
      // Atomic conditional debit (single mutation point) — also writes the
      // ledger row; rejects with 'Insufficient balance' if underfunded.
      await applyBalanceDelta(tx, userId, -amountLamports, {
        reason: 'airdrop_tip',
        refType: 'AirdropPool',
        refId: period,
      });
      await tx.airdropPool.update({
        where: { period },
        data: { tipLamports: { increment: amountLamports }, tipsCount: { increment: 1 } },
      });
    });
    const snap = await this.poolSnapshot();
    this.gateway.emitPool({
      poolLamports: snap.poolLamports,
      endsAt: snap.endsAt,
      tipsCount: snap.tipsCount,
    });
    return snap;
  }

  /**
   * Split the elapsed hour's pool among eligible users. Public so the admin
   * test endpoint can force a run; normally fired by the hourly timer.
   *
   * `forcedByUserId` is set ONLY on the admin-triggered forceDistribute path —
   * when present (and a distribution actually pays out) a `forced_airdrop`
   * `AuditLog` row is written in the SAME transaction as the payout. The hourly
   * auto-distribute (timer) is NOT a privileged action and writes no audit row.
   */
  /**
   * Sybil filter (#47): from the wager+chat candidates keep only age-confirmed
   * users and drop any cluster of accounts sharing a signup IP-hash (a free-
   * wallet farm). Users with no recorded IP are not penalised. While custody is
   * on, the pool is play-money only, so deposited accounts are not eligible.
   */
  private async filterEligibleForSybil(candidates: string[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: candidates }, ...promotionRecipients() },
      select: { id: true, ageConfirmedAt: true, signupIpHash: true },
    });
    const ageOk = users.filter((u) => u.ageConfirmedAt != null);
    const ipCount = new Map<string, number>();
    for (const u of ageOk) {
      if (u.signupIpHash) ipCount.set(u.signupIpHash, (ipCount.get(u.signupIpHash) ?? 0) + 1);
    }
    return ageOk
      .filter((u) => !u.signupIpHash || (ipCount.get(u.signupIpHash) ?? 0) <= 1)
      .map((u) => u.id);
  }

  async distribute(
    forcedByUserId?: string,
  ): Promise<{ participantCount: number; totalLamports: string }> {
    // The pool being distributed is the hour that JUST ended when fired by
    // the timer; when forced mid-hour it's the current one.
    const period = lastCompletedHourPeriod(Date.now());
    const pool = await this.prisma.airdropPool.findUnique({ where: { period } });
    const result = { participantCount: 0, totalLamports: '0' };

    try {
      if (!pool || pool.distributed) return result;
      const total = pool.baseLamports + pool.tipLamports;
      if (total <= BigInt(0)) return result;

      // Eligibility over the pool's hour: ≥ 0.001 SOL wagered AND ≥ 1 chat msg.
      const hourStart = new Date(Date.parse(
        `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}T${period.slice(8, 10)}:00:00Z`,
      ));
      const hourEnd = new Date(hourStart.getTime() + 3_600_000);
      const [wagers, chatters] = await Promise.all([
        this.prisma.bet.groupBy({
          by: ['userId'],
          where: { createdAt: { gte: hourStart, lt: hourEnd } },
          _sum: { amountLamports: true },
        }),
        this.prisma.chatMessage.groupBy({
          by: ['userId'],
          where: { createdAt: { gte: hourStart, lt: hourEnd }, deletedAt: null },
          _count: { _all: true },
        }),
      ]);
      const chatted = new Set(chatters.map((c) => c.userId));
      const candidates = wagers
        .filter((w) => (w._sum.amountLamports ?? BigInt(0)) >= BigInt(1_000_000))
        .map((w) => w.userId)
        .filter((id) => chatted.has(id));
      // Sybil resistance (#47): require age-confirmation and drop same-signup-IP
      // clusters (free-wallet farms). KYC-approval joins this gate once KYC is on.
      const eligible = await this.filterEligibleForSybil(candidates);

      if (eligible.length === 0) {
        // Nobody qualified — roll the pool into the next hour instead of burning it.
        await this.prisma.$transaction(async (tx) => {
          // Same guarded claim (#216): only the run that flips this period
          // distributed false→true rolls it over, so two concurrent no-eligible
          // runs can't double-increment the next pool.
          const claimed = await tx.airdropPool.updateMany({
            where: { period, distributed: false },
            data: { distributed: true },
          });
          if (claimed.count === 0) return; // a concurrent run already rolled it over
          await this.rollOver(tx, period, total, forcedByUserId);
        });
        this.logger.log(`airdrop ${period}: no eligible users — ${total} rolled over`);
        return result;
      }

      let payees: string[] = [];
      let share = 0n;
      await this.prisma.$transaction(async (tx) => {
        // Claim the pool atomically (#216): a guarded flip so two concurrent
        // distribute() runs can't both credit. Only the run that transitions
        // distributed false→true proceeds; a peer that already did sees count 0
        // and returns before any credit (the pre-tx check at the top is racy on
        // its own — correctness must not depend solely on the BullMQ jobId).
        const claimed = await tx.airdropPool.updateMany({
          where: { period, distributed: false },
          data: { distributed: true },
        });
        if (claimed.count === 0) return; // a concurrent run already distributed
        // The pool is play money: re-check, under row locks, that each payee is
        // still a play account now (a first deposit may have landed since the
        // eligibility read — ADR 0005).
        const kept = await stillPlay(tx, eligible);
        payees = eligible.filter((id) => kept.has(id));
        if (payees.length === 0) {
          await this.rollOver(tx, period, total, forcedByUserId);
          return;
        }
        share = total / BigInt(payees.length);
        const event = await tx.airdropEvent.create({
          data: { totalLamports: total, participantCount: payees.length },
        });
        for (const userId of payees) {
          const claim = await tx.airdropClaim.create({
            data: { eventId: event.id, userId, lamports: share },
          });
          // Credit through the single mutation point (ledger row in this tx).
          await applyBalanceDelta(tx, userId, share, {
            reason: 'airdrop_credit',
            refType: 'AirdropClaim',
            refId: claim.id,
          });
        }
        // Admin-forced distribution → append the privileged-action audit row in
        // the same tx as the payout (atomic with the credits + event).
        if (forcedByUserId) {
          await tx.auditLog.create({
            data: {
              actorUserId: forcedByUserId,
              action: 'forced_airdrop',
              targetUserId: null,
              metadataJson: {
                period,
                participantCount: payees.length,
                totalLamports: total.toString(),
              },
            },
          });
        }
      });
      if (payees.length === 0) return result;

      this.gateway.emitDropped({
        totalLamports: total.toString(),
        participantCount: payees.length,
        perUserLamports: share.toString(),
      });
      this.logger.log(
        `airdrop ${period}: ${total} lamports → ${payees.length} users (${share} each)`,
      );
      return { participantCount: payees.length, totalLamports: total.toString() };
    } finally {
      const snap = await this.poolSnapshot(); // also seeds the new hour's pool
      this.gateway.emitPool({
        poolLamports: snap.poolLamports,
        endsAt: snap.endsAt,
        tipsCount: snap.tipsCount,
      });
    }
  }

  /** Carry an undistributed pool into the next hour (and audit a forced run). */
  private async rollOver(
    tx: Prisma.TransactionClient,
    period: string,
    total: bigint,
    forcedByUserId?: string,
  ): Promise<void> {
    const nextPeriod = this.periodFor(Date.now() + 3_600_000 - 60_000);
    await tx.airdropPool.upsert({
      where: { period: nextPeriod },
      update: { baseLamports: { increment: total } },
      create: { period: nextPeriod, baseLamports: this.baseLamports + total },
    });
    // A forced run still records the privileged action even though it rolled
    // over — atomic with the rollover.
    if (forcedByUserId) {
      await tx.auditLog.create({
        data: {
          actorUserId: forcedByUserId,
          action: 'forced_airdrop',
          targetUserId: null,
          metadataJson: { period, participantCount: 0, totalLamports: total.toString(), rolledOver: true },
        },
      });
    }
  }
}
