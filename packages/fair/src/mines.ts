import { floatsFromHmac } from './floats';

/**
 * Mines field: a Fisher–Yates shuffle of [0, cells) seeded by the HMAC float
 * stream, taking the first `mines` positions. Committed once at round start (the
 * serverSeed is revealed only when the round ends / seed rotates), so the player
 * can verify after cashing out or busting that the field was fixed in advance.
 * Returns sorted mine cell indices.
 */
export function mineField(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cells: number,
  mines: number,
): number[] {
  const floats = floatsFromHmac(serverSeed, clientSeed, nonce, cells);
  const arr = Array.from({ length: cells }, (_, i) => i);
  for (let i = cells - 1; i > 0; i -= 1) {
    const j = Math.floor(floats[cells - 1 - i]! * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, mines).sort((a, b) => a - b);
}
