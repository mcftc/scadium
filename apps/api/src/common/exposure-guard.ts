import { HOUSE } from '@scadium/shared';

/**
 * Per-round house exposure guard (#30) — pure, so the policy is unit-testable.
 * A betting round may accept bets only while the SUM of their potential
 * payouts stays within MAX_ROUND_EXPOSURE_BPS of the live house bankroll;
 * each bet's potential is additionally capped by MAX_WIN_PER_BET_LAMPORTS
 * (the bankroll-sizing anchor — crash alone is otherwise unbounded).
 *
 * Engines create one guard per round (chain-enabled mode) and call
 * `reserve(potential)` at bet acceptance; `false` means reject the bet.
 */
export class ExposureGuard {
  private reserved = 0n;

  constructor(
    private readonly houseBalanceLamports: bigint,
    private readonly maxRoundExposureBps: number = HOUSE.MAX_ROUND_EXPOSURE_BPS,
  ) {}

  /** Cap a single bet's potential payout at the per-bet maximum win. */
  static potential(stakeLamports: bigint, maxMultiplier: number): bigint {
    const raw = stakeLamports * BigInt(Math.ceil(maxMultiplier));
    const cap = BigInt(HOUSE.MAX_WIN_PER_BET_LAMPORTS);
    return raw < cap ? raw : cap;
  }

  get roundCapLamports(): bigint {
    return (this.houseBalanceLamports * BigInt(this.maxRoundExposureBps)) / 10_000n;
  }

  get reservedLamports(): bigint {
    return this.reserved;
  }

  /** Try to reserve `potential` exposure; false = the bet must be rejected. */
  reserve(potentialLamports: bigint): boolean {
    if (potentialLamports <= 0n) return false;
    if (this.reserved + potentialLamports > this.roundCapLamports) return false;
    this.reserved += potentialLamports;
    return true;
  }

  /** Free previously-reserved exposure (bet replaced/cleared before the deal). */
  release(potentialLamports: bigint): void {
    this.reserved = this.reserved > potentialLamports ? this.reserved - potentialLamports : 0n;
  }
}
