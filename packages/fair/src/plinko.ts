import { floatsFromHmac } from './floats';

export interface PlinkoDrop {
  /** Per-row direction: 0 = left, 1 = right. Length === rows. */
  path: number[];
  /** Final bin index in [0, rows] (= number of right bounces). */
  bin: number;
}

/**
 * Plinko ball path: one uniform float per row decides left/right (>= 0.5 → right).
 * The final bin is the count of right bounces, giving a binomial distribution
 * over `rows + 1` bins. The service maps `bin` → payout via the shared multiplier
 * table (keyed by rows + risk).
 */
export function plinkoDrop(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  rows: number,
): PlinkoDrop {
  const floats = floatsFromHmac(serverSeed, clientSeed, nonce, rows);
  const path = floats.map((f): number => (f >= 0.5 ? 1 : 0));
  const bin = path.reduce((a, b) => a + b, 0);
  return { path, bin };
}
