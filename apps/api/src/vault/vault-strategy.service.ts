import { Injectable, Logger } from '@nestjs/common';
import {
  VAULT,
  type VaultStrategy,
  investableExcess,
  divestForBufferFloor,
  harvestableYield,
  vaultStrategyDrift,
} from '@scadium/shared';
import { ChainService } from '../solana/chain.service';

/**
 * SCAD Vault — Faz 3 strategy manager (V11 jitoSOL / V12 Kamino).
 *
 * Owns the invest / divest / harvest cadence per term pool: keep `BUFFER_BPS`
 * of a pool's assets liquid for instant withdrawals, deploy the excess into the
 * pool's yield strategy (never above `MAX_INVESTED_BPS`), and credit realised
 * strategy yield to the pool index — reusing the Faz-1 share/index machinery
 * unchanged (see `docs/runbooks/vault-faz3-defi-design.md` §3).
 *
 * **Status: off-chain skeleton.** The planning logic (`planRebalance` /
 * `planHarvest`) is pure and fully tested; the executors are gated on
 * `ChainService.enabled` and no-op today because the `vault_invest` /
 * `vault_divest` / `vault_harvest` instructions are not deployed yet (Faz 3 is
 * blocked on deploy + audit + legal, §0). This service is the wired interface so
 * the worker/reconciliation can be hooked up the moment the program ships.
 */
@Injectable()
export class VaultStrategyService {
  private readonly logger = new Logger(VaultStrategyService.name);

  constructor(private readonly chain: ChainService) {}

  /**
   * A pool's strategy accounting at a point in time. `liquid` = assets in the
   * pool token account; `invested` = cost basis deployed in the strategy;
   * `strategyValue` = the position's current on-chain worth (≥ invested once
   * yield accrues). All amounts are the pool asset's base units.
   */
  // (kept as a JSDoc-described shape; declared inline on the methods below)

  /**
   * Decide the next invest/divest move for a pool from a snapshot — pure, so it
   * is unit-tested directly and mirrors the on-chain buffer rule bit-for-bit.
   * Invest the liquid above the buffer target (capped), else refill the buffer
   * when liquid has fallen below the floor, else hold.
   */
  static planRebalance(snap: {
    strategy: VaultStrategy;
    totalAssets: bigint;
    liquid: bigint;
    invested: bigint;
  }): { action: 'none' } | { action: 'invest'; amount: bigint } | { action: 'divest'; amount: bigint } {
    if (snap.strategy === 'none' || snap.totalAssets <= 0n) return { action: 'none' };
    const { BUFFER_BPS, BUFFER_FLOOR_BPS, MAX_INVESTED_BPS, MIN_INVEST_BASE } = VAULT.STRATEGY;

    const toInvest = investableExcess({
      liquid: snap.liquid,
      invested: snap.invested,
      totalAssets: snap.totalAssets,
      bufferBps: BUFFER_BPS,
      maxInvestedBps: MAX_INVESTED_BPS,
    });
    if (toInvest >= BigInt(MIN_INVEST_BASE)) return { action: 'invest', amount: toInvest };

    const toDivest = divestForBufferFloor({
      liquid: snap.liquid,
      invested: snap.invested,
      totalAssets: snap.totalAssets,
      bufferBps: BUFFER_BPS,
      floorBps: BUFFER_FLOOR_BPS,
    });
    if (toDivest > 0n) return { action: 'divest', amount: toDivest };

    return { action: 'none' };
  }

  /** Yield to credit the pool index at harvest = strategy gain above cost basis (≥ 0). */
  static planHarvest(snap: { strategyValue: bigint; invested: bigint }): { yieldAssets: bigint } {
    return { yieldAssets: harvestableYield(snap.strategyValue, snap.invested) };
  }

  /**
   * Run a pool's rebalance (worker-driven, once per `HARVEST_INTERVAL_MS`). No-op
   * until the chain layer is enabled — there is nothing to deploy off-chain.
   */
  async rebalance(snap: {
    termDays: number;
    strategy: VaultStrategy;
    totalAssets: bigint;
    liquid: bigint;
    invested: bigint;
  }): Promise<{ action: 'none' | 'invest' | 'divest'; amount: bigint; txSig: string | null }> {
    const plan = VaultStrategyService.planRebalance(snap);
    if (plan.action === 'none') return { action: 'none', amount: 0n, txSig: null };
    if (!this.chain.enabled) {
      this.logger.debug(
        `rebalance(term ${snap.termDays}): would ${plan.action} ${plan.amount} — chain disabled, skipping`,
      );
      return { action: plan.action, amount: plan.amount, txSig: null };
    }
    const txSig =
      plan.action === 'invest'
        ? await this.chain.vaultInvest({ termDays: snap.termDays, amount: plan.amount })
        : await this.chain.vaultDivest({ termDays: snap.termDays, amount: plan.amount });
    return { action: plan.action, amount: plan.amount, txSig };
  }

  /**
   * Harvest a pool's accrued strategy yield to the index. No-op until enabled.
   * Returns the yield it would credit (0 when flat / disabled / no position).
   */
  async harvest(termDays: number): Promise<{ yieldAssets: bigint; txSig: string | null }> {
    if (!this.chain.enabled) return { yieldAssets: 0n, txSig: null };
    const strategyValue = await this.chain.readStrategyValue(termDays);
    if (strategyValue === null) return { yieldAssets: 0n, txSig: null };
    const txSig = await this.chain.vaultHarvest({ termDays });
    return { yieldAssets: 0n, txSig };
  }

  /**
   * Flag-only strategy reconciliation: a pool's `totalAssets` must equal
   * `liquid + strategyValue` within `DRIFT_TOLERANCE_BPS`. Returns the drift and
   * an `unwindShortfall` flag (the strategy can't cover a queued withdrawal).
   * Returns null when the chain layer is disabled (no on-chain truth to compare).
   */
  async strategyDrift(snap: {
    termDays: number;
    totalAssets: bigint;
    liquid: bigint;
    queuedWithdrawal?: bigint;
  }): Promise<{ drift: bigint; ok: boolean; unwindShortfall: boolean } | null> {
    if (!this.chain.enabled) return null;
    const strategyValue = (await this.chain.readStrategyValue(snap.termDays)) ?? 0n;
    const { drift, ok } = vaultStrategyDrift({
      totalAssets: snap.totalAssets,
      liquid: snap.liquid,
      strategyValue,
      toleranceBps: VAULT.STRATEGY.DRIFT_TOLERANCE_BPS,
    });
    const queued = snap.queuedWithdrawal ?? 0n;
    const unwindShortfall = queued > snap.liquid + strategyValue;
    if (!ok) this.logger.error(`vaultStrategyDrift(term ${snap.termDays}): drift ${drift} out of tolerance`);
    if (unwindShortfall)
      this.logger.error(`vaultStrategyDrift(term ${snap.termDays}): unwind shortfall for queued ${queued}`);
    return { drift, ok, unwindShortfall };
  }
}
