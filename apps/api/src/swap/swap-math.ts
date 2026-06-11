import { SWAP } from '@scadium/shared';

/**
 * Constant-product swap math (#31) — MUST stay in lockstep with the on-chain
 * `cpmm_out` in programs/scadium_swap/src/lib.rs. Pure, so the buy-and-burn
 * min-out policy is unit-testable: the house trade was previously submitted
 * with `min_out = 0`, leaving every automated burn fully sandwichable.
 */
export function expectedSwapOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inAfterFee = (amountIn * (10_000n - feeBps)) / 10_000n;
  return (inAfterFee * reserveOut) / (reserveIn + inAfterFee);
}

/** The minimum acceptable output given the configured slippage tolerance. */
export function minOutWithSlippage(
  expectedOut: bigint,
  maxSlippageBps: number = SWAP.MAX_SLIPPAGE_BPS,
): bigint {
  if (expectedOut <= 0n) return 0n;
  return (expectedOut * BigInt(10_000 - maxSlippageBps)) / 10_000n;
}
