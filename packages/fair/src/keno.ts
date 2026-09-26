import { KENO } from '@scadium/shared';
import { floatsFromHmac } from './floats';

/**
 * Keno draw: KENO.DRAWS distinct numbers from 1..KENO.CELLS — a Fisher–Yates
 * shuffle driven by the canonical float stream (the same shuffle as mines),
 * keeping the first DRAWS. Sorted ascending.
 */
export function kenoDraw(serverSeed: string, clientSeed: string, nonce: number): number[] {
  const cells = KENO.CELLS;
  const floats = floatsFromHmac(serverSeed, clientSeed, nonce, cells);
  const arr = Array.from({ length: cells }, (_, i) => i + 1);
  for (let i = cells - 1; i > 0; i -= 1) {
    const j = Math.floor(floats[cells - 1 - i]! * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, KENO.DRAWS).sort((a, b) => a - b);
}

/** How many of `picks` are in `drawn`. */
export function kenoHits(picks: readonly number[], drawn: readonly number[]): number {
  const set = new Set(drawn);
  return picks.filter((p) => set.has(p)).length;
}
