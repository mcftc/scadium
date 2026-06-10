import { buildMessage, hmacSha256 } from './hash';
import { lotteryFinalEntropy, padClientSeed32 } from './lottery';

/**
 * Crash bust derived from on-chain entropy (ADR 0002 / #101). Folds a pinned
 * slot's hash — unknown to the operator at commit time — into the derivation, so
 * the bust cannot be ground when the round opens. Reuses the canonical
 * `finalEntropy = sha256(serverSeed ‖ slotHash ‖ clientSeed32 ‖ u32le(nonce))`
 * encoding (golden-locked across Rust / Node / browser by the lottery), then maps
 * its first 13 hex chars through the SAME 5%-edge crash formula as `crashPoint`.
 */
export function crashPointFromSlot(
  serverSeed: string,
  clientSeed: string,
  slotHash: Uint8Array,
  nonce = 0,
): number {
  const entropy = lotteryFinalEntropy(serverSeed, padClientSeed32(clientSeed), slotHash, nonce);
  const h = parseInt(entropy.toString('hex').slice(0, 13), 16);
  if (h % 20 === 0) return 1.0;
  const e = 2 ** 52;
  return Math.floor((100 * e - h) / (e - h)) / 100;
}

/**
 * Compute the crash-point multiplier for a round, matching the solpump.io
 * canonical provably-fair formula.
 *
 * Algorithm:
 *   1. h_hex = HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)
 *   2. Take the first 13 hex chars of h_hex and parse as an integer `h`.
 *   3. If `h % 20 === 0`, return 1.00 (instant bust — ~5% of rounds).
 *   4. Otherwise, return floor((100 * 2^52 - h) / (2^52 - h)) / 100.
 *
 * This yields a house edge of exactly 5% and is fully reproducible by any
 * client that knows the three seed inputs.
 */
export function crashPoint(serverSeed: string, clientSeed: string, nonce: number): number {
  const hash = hmacSha256(serverSeed, buildMessage(clientSeed, nonce));
  const h = parseInt(hash.slice(0, 13), 16);

  // Instant bust on 1-in-20 rounds (matches the 5% house edge)
  if (h % 20 === 0) return 1.0;

  const e = 2 ** 52;
  return Math.floor((100 * e - h) / (e - h)) / 100;
}

/**
 * Exponential growth curve used by the crash multiplier UI & engine.
 * Returns the multiplier at `tMs` milliseconds after round start.
 *
 * The rate constant 1.06 per second (≈ 1.00024^t_ms) is chosen so that
 * bust-point distribution looks natural over a 0–30 second round.
 */
export function crashMultiplierAt(tMs: number, growthRate = 1.00024): number {
  if (tMs <= 0) return 1.0;
  return Math.max(1.0, Number((growthRate ** tMs).toFixed(2)));
}

/**
 * Inverse of crashMultiplierAt — how many ms after round start do we reach
 * a given multiplier? Used for autoCashout scheduling.
 */
export function crashTimeForMultiplier(multiplier: number, growthRate = 1.00024): number {
  if (multiplier <= 1) return 0;
  return Math.ceil(Math.log(multiplier) / Math.log(growthRate));
}
