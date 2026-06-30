import { Injectable } from '@nestjs/common';
import { SCAD, emissionPhaseFor } from '@scadium/shared';
import { DistributionService } from '../engine/distribution.service';
import { ProofOfWagerService } from '../proof-of-wager/proof-of-wager.service';

/**
 * Read-only $SCAD tokenomics aggregate for the public /token/stats endpoint and
 * the web Tokenomics dashboard. Composes the persistent emission counter (P2E
 * halving) with the engine's burn / dividend totals — NEVER mutates balances.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly pow: ProofOfWagerService,
    private readonly distribution: DistributionService,
  ) {}

  /** Static 6-way distribution breakdown (fractions + whole-token amounts). */
  private allocation() {
    const total = SCAD.TOTAL_SUPPLY;
    const slices: { key: string; label: string; fraction: number }[] = [
      { key: 'p2e', label: 'Play-to-Earn', fraction: SCAD.ALLOC_P2E },
      { key: 'community', label: 'Community / Airdrop', fraction: SCAD.ALLOC_COMMUNITY },
      { key: 'liquidity', label: 'Liquidity', fraction: SCAD.ALLOC_LIQUIDITY },
      { key: 'treasury', label: 'Treasury / Ecosystem / MM', fraction: SCAD.ALLOC_TREASURY },
      { key: 'team', label: 'Team', fraction: SCAD.ALLOC_TEAM },
      { key: 'strategic', label: 'Strategic', fraction: SCAD.ALLOC_STRATEGIC },
    ];
    return slices.map((s) => ({ ...s, whole: Math.round(total * s.fraction) }));
  }

  /**
   * Full tokenomics snapshot. All SCAD figures are BASE units (9 decimals) as
   * strings (BigInt-safe over JSON); `totalSupply` is whole tokens.
   */
  async stats() {
    const [totalEmitted, engine] = await Promise.all([
      this.pow.totalEmitted(),
      this.distribution.engineStats(),
    ]);
    const { phase, ratePerLamport, toNextHalvingBase } = emissionPhaseFor(totalEmitted);

    return {
      totalSupply: SCAD.TOTAL_SUPPLY, // whole tokens (fixed max supply)
      decimals: SCAD.DECIMALS,
      totalEmittedScad: totalEmitted.toString(), // base units
      p2ePoolBase: SCAD.P2E_POOL_BASE.toString(), // base units (500M × 1e9)
      currentPhase: phase, // 1..7
      phaseCount: SCAD.EMISSION_PHASES.length,
      currentRatePerLamport: ratePerLamport, // = SCAD per 1 SOL wagered (phase rate)
      toNextHalvingBase: toNextHalvingBase.toString(), // base units to next halving (0 = exhausted)
      phases: SCAD.EMISSION_PHASES.map((p) => ({
        ratePerLamport: p.ratePerLamport,
        cumulativeCapBase: p.cumulativeCapBase.toString(),
      })),
      totalDistributedUsds: engine.totalDistributedUsds, // USDS base units
      allocation: this.allocation(),
    };
  }
}
