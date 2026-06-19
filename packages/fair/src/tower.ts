import { floatsFromHmac } from './floats';

/**
 * Tower trap layout: each of `rows` rows has `columns` tiles, of which
 * `columns - safePerRow` are traps. Per row we Fisher–Yates shuffle the column
 * indices (from the shared HMAC float stream) and take the first `trapsPerRow`
 * as traps. Committed at round start; the player climbs one tile per row and
 * busts on a trap. Returns sorted trap column indices for each row.
 */
export function towerTraps(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  rows: number,
  columns: number,
  safePerRow: number,
): number[][] {
  const trapsPerRow = columns - safePerRow;
  const floats = floatsFromHmac(serverSeed, clientSeed, nonce, rows * columns);
  const out: number[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const arr = Array.from({ length: columns }, (_, i) => i);
    for (let i = columns - 1; i > 0; i -= 1) {
      const j = Math.floor(floats[r * columns + (columns - 1 - i)]! * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    out.push(arr.slice(0, trapsPerRow).sort((a, b) => a - b));
  }
  return out;
}
