import { Injectable, Logger } from '@nestjs/common';
import {
  ENGINE,
  VAULT,
  vaultYieldSliceLamports,
  lamportsToScadBase,
  assetsForShares,
  applyAccrual,
} from '@scadium/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ChainService } from '../solana/chain.service';
import { periodForHour } from '../queue/queue.constants';

/**
 * SCAD Vault — hourly yield accrual (the Vault analogue of the Engine's
 * DistributionService).
 *
 * Each round covers one UTC hour. The Vault takes its own slice of that hour's
 * NGR (`VAULT.YIELD_NGR_BPS`), converts it to $SCAD, and splits it across the
 * active term pools by `weightBps × totalShares` (longer terms + more stake →
 * larger share → higher effective APR). Each pool's slice is credited to the
 * pool INDEX via `applyAccrual`, so every position appreciates pro-rata — the
 * yield materialises as $SCAD only when a user withdraws (value > principal).
 *
 * Independent of the Engine dividend + buy-and-burn slices (each takes its own
 * bps of the same NGR; the total is invariant ≤ 20% — see `ngrRedistributionBps`).
 * Idempotency mirrors DistributionService: one `VaultAccrualRound` per `period`
 * (unique) guarded by `distributed`, so a re-fire of the same hour adds nothing
 * twice. The worker additionally holds a Redis lock around the run.
 */
@Injectable()
export class VaultAccrualService {
  private readonly logger = new Logger(VaultAccrualService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {}

  /** Hour window [start, end) for a `YYYYMMDDHH` period key. */
  private hourWindow(period: string): { start: Date; end: Date } {
    const start = new Date(
      Date.parse(
        `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}T${period.slice(8, 10)}:00:00Z`,
      ),
    );
    return { start, end: new Date(start.getTime() + 3_600_000) };
  }

  /**
   * Run the accrual round for the hour that just ended. Safe to call repeatedly:
   * a settled round returns immediately.
   */
  async accrue(): Promise<{ period: string; poolCount: number; yieldScad: string }> {
    const period = periodForHour(Date.now() - 60_000);
    const noop = { period, poolCount: 0, yieldScad: '0' };

    const existing = await this.prisma.vaultAccrualRound.findUnique({ where: { period } });
    if (existing?.distributed) return noop;

    const { start, end } = this.hourWindow(period);
    const agg = await this.prisma.bet.aggregate({
      where: { createdAt: { gte: start, lt: end } },
      _sum: { amountLamports: true, payoutLamports: true },
    });
    const ngr = (agg._sum.amountLamports ?? 0n) - (agg._sum.payoutLamports ?? 0n);
    const totalYield = lamportsToScadBase(vaultYieldSliceLamports(ngr));

    // Eligible pools: active with stakers. Weight = relative term weight × stake.
    const pools = await this.prisma.vaultPool.findMany({
      where: { active: true, totalShares: { gt: 0n } },
    });
    const totalWeight = pools.reduce((a, p) => a + BigInt(p.weightBps) * p.totalShares, 0n);

    // Nothing to distribute → settle the round zero so it isn't retried forever.
    if (
      totalYield < BigInt(VAULT.MIN_ACCRUAL_SCAD_BASE) ||
      pools.length === 0 ||
      totalWeight <= 0n
    ) {
      await this.prisma.vaultAccrualRound.upsert({
        where: { period },
        update: { distributed: true, distributedAt: new Date(), ngrLamports: ngr, yieldScad: 0n },
        create: { period, distributed: true, distributedAt: new Date(), ngrLamports: ngr },
      });
      this.logger.log(
        `vault accrual ${period}: no yield (ngr=${ngr}, yield=${totalYield}, pools=${pools.length})`,
      );
      return noop;
    }

    const roundsPerYear = Math.round((365 * 24 * 60 * 60 * 1000) / ENGINE.DISTRIBUTION_INTERVAL_MS);

    // Pools credited this round — used after commit to mirror the yield on-chain
    // (best-effort) when the chain is live.
    const mirror: { eventId: string; termDays: number; amount: bigint }[] = [];

    await this.prisma.$transaction(async (tx) => {
      const round = await tx.vaultAccrualRound.upsert({
        where: { period },
        update: {},
        create: { period },
      });
      if (round.distributed) return; // raced — another worker settled it

      let allocated = 0n;
      let credited = 0;
      for (const p of pools) {
        const weight = BigInt(p.weightBps) * p.totalShares;
        const poolYield = (totalYield * weight) / totalWeight;
        if (poolYield <= 0n) continue;

        const newIndex = applyAccrual(p.indexRay, p.totalShares, poolYield);
        const valueBefore = assetsForShares(p.totalShares, p.indexRay);
        const aprBps =
          valueBefore > 0n
            ? Number((poolYield * 10_000n * BigInt(roundsPerYear)) / valueBefore)
            : 0;

        await tx.vaultPool.update({
          where: { id: p.id },
          data: {
            indexRay: newIndex,
            totalAssets: { increment: poolYield },
            lastAccrualAt: new Date(),
            aprBps,
          },
        });
        const event = await tx.vaultEvent.create({
          data: {
            poolId: p.id,
            kind: 'accrue',
            assetsDelta: poolYield,
            sharesDelta: 0n,
            penaltyAssets: 0n,
            indexRayAfter: newIndex,
          },
        });
        mirror.push({ eventId: event.id, termDays: p.termDays, amount: poolYield });
        allocated += poolYield;
        credited += 1;
      }

      await tx.vaultAccrualRound.update({
        where: { id: round.id },
        data: {
          distributed: true,
          distributedAt: new Date(),
          ngrLamports: ngr,
          yieldScad: allocated,
          poolCount: credited,
        },
      });
    });

    // Off-chain ledger is the source of truth; when the chain is live, mirror the
    // per-pool yield on-chain (cosigner-signed) and stamp the event's tx sig.
    // No-op while disabled (play-money) — vaultAccrue returns null immediately.
    if (this.chain.enabled) {
      for (const m of mirror) {
        const sig = await this.chain.vaultAccrue({
          termDays: m.termDays,
          amountScadBase: m.amount,
        });
        if (sig) {
          await this.prisma.vaultEvent.update({
            where: { id: m.eventId },
            data: { txSignature: sig },
          });
        }
      }
    }

    this.logger.log(
      `vault accrual ${period}: ${totalYield} SCAD across ${pools.length} pools (ngr=${ngr})`,
    );
    return { period, poolCount: pools.length, yieldScad: totalYield.toString() };
  }
}
