import { describe, it, expect } from 'vitest';
import { SWAP } from '@scadium/shared';
import { expectedSwapOut, minOutWithSlippage } from './swap-math';

/**
 * #31 — the buy-and-burn must never submit `min_out = 0`. The min-out policy is
 * pure: expected CPMM output (mirrors the program's `cpmm_out`) shaved by the
 * configured slippage tolerance.
 */
describe('buy-and-burn min-out policy (#31)', () => {
  // 100 SOL / 10M SCAD pool, 1% fee — mirrors the on-chain fee_bps=100 init.
  const SOL_RES = 100n * 10n ** 9n;
  const SCAD_RES = 10_000_000n * 10n ** 9n;

  it('expectedSwapOut mirrors the on-chain constant-product formula', () => {
    const amountIn = 10n ** 9n; // 1 SOL
    const inAfterFee = (amountIn * (10_000n - 100n)) / 10_000n;
    const manual = (inAfterFee * SCAD_RES) / (SOL_RES + inAfterFee);
    expect(expectedSwapOut(amountIn, SOL_RES, SCAD_RES, 100n)).toBe(manual);
    expect(manual).toBeGreaterThan(0n);
  });

  it('minOut equals expected × (1 − MAX_SLIPPAGE_BPS/10000) and is NON-ZERO', () => {
    const expected = expectedSwapOut(10n ** 9n, SOL_RES, SCAD_RES, 100n);
    const minOut = minOutWithSlippage(expected);
    expect(minOut).toBe((expected * BigInt(10_000 - SWAP.MAX_SLIPPAGE_BPS)) / 10_000n);
    expect(minOut).toBeGreaterThan(0n);
    expect(minOut).toBeLessThan(expected);
  });

  it('aborts (zero) on empty/unusable reserves instead of submitting min_out 0', () => {
    expect(expectedSwapOut(10n ** 9n, 0n, SCAD_RES, 100n)).toBe(0n);
    expect(expectedSwapOut(10n ** 9n, SOL_RES, 0n, 100n)).toBe(0n);
    expect(minOutWithSlippage(0n)).toBe(0n); // caller treats 0 as "skip the burn"
  });

  it('a reserve shift beyond tolerance makes the realized output fail min_out', () => {
    const amountIn = 10n ** 9n;
    const minOut = minOutWithSlippage(expectedSwapOut(amountIn, SOL_RES, SCAD_RES, 100n));
    // Adversary moves the pool 5% against us before our tx lands (> 1% tolerance):
    const shiftedOut = expectedSwapOut(amountIn, SOL_RES + SOL_RES / 20n, SCAD_RES - SCAD_RES / 20n, 100n);
    expect(shiftedOut).toBeLessThan(minOut); // program reverts SlippageExceeded
  });
});
