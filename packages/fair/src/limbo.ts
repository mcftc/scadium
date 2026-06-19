import { floatsFromHmac } from './floats';

/**
 * Limbo result multiplier (≥ 1.00), crash-style. One uniform float `u` maps to
 * `(1 - edge) / u`, floored to 2 decimals. The player picks a target multiplier
 * and wins when `result >= target`, paying exactly that target. The `edge`
 * (default 1%) is baked into the distribution so the EV is correct regardless of
 * the target chosen.
 */
export function limboResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  edge = 0.01,
): number {
  const [u] = floatsFromHmac(serverSeed, clientSeed, nonce, 1);
  // Guard the degenerate u≈0 tail at a sane ceiling rather than Infinity.
  const raw = u! <= 0 ? 1_000_000 : (1 - edge) / u!;
  return Math.max(1, Math.floor(raw * 100) / 100);
}
