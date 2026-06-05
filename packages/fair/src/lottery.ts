import { hmacSha256 } from './hash';

/**
 * Provably-fair lottery draw: pick 5 distinct main numbers from 1..36 plus
 * one bonus number from 1..10, derived deterministically from the committed
 * seed pair. Reproducible by anyone via the /fairness verifier.
 *
 * Algorithm (mirrors the crash/coinflip primitives — HMAC-SHA256 over a
 * per-slot message):
 *   - For each of the 5 main slots i: h = HMAC(serverSeed, `${clientSeed}:${nonce}:m${i}`),
 *     r = parseInt(h.slice(0,13),16) % poolSize, take pool[r] and remove it
 *     (a seeded Fisher-Yates draw without replacement).
 *   - Bonus: h = HMAC(serverSeed, `${clientSeed}:${nonce}:b`),
 *     bonus = parseInt(h.slice(0,13),16) % 10 + 1.
 *
 * These spec constants are intentionally hard-coded here — they ARE the game
 * rules, and the in-browser verifier must use the identical values.
 */
export const LOTTERY_MAIN_MAX = 36;
export const LOTTERY_MAIN_COUNT = 5;
export const LOTTERY_BONUS_MAX = 10;

export interface LotteryResult {
  main: number[]; // 5 distinct numbers in 1..36, ascending
  bonus: number; // 1..10
}

export function lotteryDraw(serverSeed: string, clientSeed: string, nonce: number): LotteryResult {
  const pool = Array.from({ length: LOTTERY_MAIN_MAX }, (_, i) => i + 1);
  const main: number[] = [];
  for (let i = 0; i < LOTTERY_MAIN_COUNT; i++) {
    const hash = hmacSha256(serverSeed, `${clientSeed}:${nonce}:m${i}`);
    const r = parseInt(hash.slice(0, 13), 16) % pool.length;
    main.push(pool[r]!);
    pool.splice(r, 1);
  }
  main.sort((a, b) => a - b);

  const hashB = hmacSha256(serverSeed, `${clientSeed}:${nonce}:b`);
  const bonus = (parseInt(hashB.slice(0, 13), 16) % LOTTERY_BONUS_MAX) + 1;

  return { main, bonus };
}

/** Count how many of a ticket's picks match a draw. */
export function lotteryMatches(
  ticketMain: number[],
  ticketBonus: number,
  drawMain: number[],
  drawBonus: number,
): { matchedMain: number; matchedBonus: number } {
  const drawn = new Set(drawMain);
  const matchedMain = ticketMain.filter((n) => drawn.has(n)).length;
  const matchedBonus = ticketBonus === drawBonus ? 1 : 0;
  return { matchedMain, matchedBonus };
}
