/**
 * Treasury solvency guard (#54). Pure helpers for the pre-payout reserve check:
 * before the house pays out SOL, it must still hold at least the documented
 * reserve floor afterward. This refuses an under-reserved payout BEFORE it
 * reaches the program's on-chain `InsufficientFunds` path (which would surface
 * as a hard failure / stranded settlement) — see docs/bankroll-model.md.
 *
 * Kept pure (no I/O) so the math is unit-tested directly; ChainService reads the
 * live balance and wires these in.
 */

/**
 * The documented reserve floor in lamports = rent floor (PDA must stay
 * rent-exempt) + an operational bankroll buffer.
 */
export function reserveFloorLamports(rentFloor: bigint, bufferLamports: bigint): bigint {
  return rentFloor + bufferLamports;
}

/**
 * True if the house vault can pay `housePaysNet` lamports and still hold at
 * least `floorLamports`. `housePaysNet` is the NET the house pays on a win
 * (payout − stake); for a loss the house gains, so callers pass ≤ 0 (always
 * covered).
 */
export function coversReserve(
  houseLamports: bigint,
  housePaysNet: bigint,
  floorLamports: bigint,
): boolean {
  if (housePaysNet <= 0n) return true;
  return houseLamports - housePaysNet >= floorLamports;
}
