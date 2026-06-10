import { BadRequestException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { AirdropGateway } from './airdrop.gateway';

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
  private timer: NodeJS.Timeout | null = null;

  /** Pool seed per hour — dev default 0.05 SOL, override via env. */
  private readonly baseLamports = BigInt(
    process.env.AIRDROP_BASE_LAMPORTS ?? 50_000_000,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AirdropGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureCurrentPool();
    this.scheduleNextDistribution();
  }

  /** Period key for the hour containing `ms` (UTC, YYYYMMDDHH). */
  private periodFor(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
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

  private scheduleNextDistribution() {
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.max(1_000, this.nextBoundary() - Date.now());
    this.timer = setTimeout(() => {
      void this.distribute().catch((e) =>
        this.logger.error(`airdrop distribution failed: ${e instanceof Error ? e.message : e}`),
      );
    }, delay);
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
    const period = this.periodFor(Date.now());
    const pool = await this.ensureCurrentPool();
    // Guard against tipping into an already-settled pool (only reachable when
    // a distribution was forced mid-hour in dev) — the tip would be stranded.
    if (pool.distributed) throw new Error('This hour’s pool already settled — try after the hour');
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found');
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
  async distribute(
    forcedByUserId?: string,
  ): Promise<{ participantCount: number; totalLamports: string }> {
    // The pool being distributed is the hour that JUST ended when fired by
    // the timer; when forced mid-hour it's the current one.
    const period = this.periodFor(Date.now() - 60_000);
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
      const eligible = wagers
        .filter((w) => (w._sum.amountLamports ?? BigInt(0)) >= BigInt(1_000_000))
        .map((w) => w.userId)
        .filter((id) => chatted.has(id));

      if (eligible.length === 0) {
        // Nobody qualified — roll the pool into the next hour instead of burning it.
        const nextPeriod = this.periodFor(Date.now() + 3_600_000 - 60_000);
        const ops: Prisma.PrismaPromise<unknown>[] = [
          this.prisma.airdropPool.update({ where: { period }, data: { distributed: true } }),
          this.prisma.airdropPool.upsert({
            where: { period: nextPeriod },
            update: { baseLamports: { increment: total } },
            create: { period: nextPeriod, baseLamports: this.baseLamports + total },
          }),
        ];
        // Forced run still records the privileged action even though it rolled
        // over (no eligible users) — atomic with the rollover.
        if (forcedByUserId) {
          ops.push(
            this.prisma.auditLog.create({
              data: {
                actorUserId: forcedByUserId,
                action: 'forced_airdrop',
                targetUserId: null,
                metadataJson: {
                  period,
                  participantCount: 0,
                  totalLamports: total.toString(),
                  rolledOver: true,
                },
              },
            }),
          );
        }
        await this.prisma.$transaction(ops);
        this.logger.log(`airdrop ${period}: no eligible users — ${total} rolled over`);
        return result;
      }

      const share = total / BigInt(eligible.length);
      await this.prisma.$transaction(async (tx) => {
        await tx.airdropPool.update({ where: { period }, data: { distributed: true } });
        const event = await tx.airdropEvent.create({
          data: { totalLamports: total, participantCount: eligible.length },
        });
        for (const userId of eligible) {
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
                participantCount: eligible.length,
                totalLamports: total.toString(),
              },
            },
          });
        }
      });

      this.gateway.emitDropped({
        totalLamports: total.toString(),
        participantCount: eligible.length,
        perUserLamports: share.toString(),
      });
      this.logger.log(
        `airdrop ${period}: ${total} lamports → ${eligible.length} users (${share} each)`,
      );
      return { participantCount: eligible.length, totalLamports: total.toString() };
    } finally {
      const snap = await this.poolSnapshot(); // also seeds the new hour's pool
      this.gateway.emitPool({
        poolLamports: snap.poolLamports,
        endsAt: snap.endsAt,
        tipsCount: snap.tipsCount,
      });
      this.scheduleNextDistribution();
    }
  }
}
