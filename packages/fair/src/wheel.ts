import { floatsFromHmac } from './floats';

/**
 * Wheel of fortune: one uniform float selects a segment index in
 * [0, segmentCount). The per-segment multiplier table lives in shared constants
 * (keyed by risk level), so the service maps the index → payout. Equal-width
 * segments keep the math transparent; weighting is expressed by repeating a
 * multiplier across multiple segments in the table.
 */
export function wheelSpin(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  segmentCount: number,
): number {
  const [u] = floatsFromHmac(serverSeed, clientSeed, nonce, 1);
  const idx = Math.floor(u! * segmentCount);
  return idx >= segmentCount ? segmentCount - 1 : idx; // guard u→1 edge
}
