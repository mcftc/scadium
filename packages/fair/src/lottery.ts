import { createHash } from 'node:crypto';

/**
 * Provably-fair lottery draw: pick 5 distinct main numbers from 1..36 plus
 * one bonus number from 1..10, derived deterministically from the committed
 * seed pair AND a Solana slot hash that did not exist at commit time.
 * Reproducible by anyone via the /fairness verifier, and re-derived
 * INSIDE the on-chain program at reveal (the cosigner cannot pick numbers).
 *
 * Canonical byte layout (must stay in lockstep with
 * `programs/scadium_lottery/src/lib.rs` and `apps/web/src/lib/fair-browser.ts`):
 *
 *   finalEntropy = sha256( utf8(serverSeedHex64) || slotHash[32] || clientSeed32 || u32le(nonce) )
 *   main slot i (0..4): h = sha256(finalEntropy || [0x6d, i])
 *                       r = u64_be(h[0..8]) % poolLen → take pool[r], remove (no replacement)
 *                       then sort ascending
 *   bonus:              h = sha256(finalEntropy || [0x62])
 *                       bonus = u64_be(h[0..8]) % 10 + 1
 *
 * - serverSeed: the 64 ASCII hex chars as utf8 bytes (= on-chain `revealed_seed[64]`).
 * - clientSeed32: utf8 bytes of the client seed hex string, zero-padded to 32
 *   (= on-chain `client_seed[32]`). Use `padClientSeed32` — hashing the raw
 *   variable-length string would NOT match the program.
 * - slotHash: the 32 raw bytes of the SlotHashes entry at the draw's target slot.
 * - nonce: u32 little-endian; always 0 for the lottery (kept for future-proofing).
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

/** Zero-pad the utf8 bytes of a client-seed string to the on-chain 32-byte form. */
export function padClientSeed32(clientSeed: string): Buffer {
  const out = Buffer.alloc(32);
  Buffer.from(clientSeed, 'utf8').copy(out, 0, 0, 32);
  return out;
}

/**
 * sha256( utf8(serverSeedHex) || slotHash || clientSeed32 || u32le(nonce) ) —
 * the 32-byte entropy every number is derived from. Exposed so callers
 * (engine, verifier) can display/compare it against the on-chain
 * `Draw.final_entropy`.
 */
export function lotteryFinalEntropy(
  serverSeed: string,
  clientSeed32: Uint8Array,
  slotHash: Uint8Array,
  nonce = 0,
): Buffer {
  if (clientSeed32.length !== 32) throw new Error('clientSeed32 must be exactly 32 bytes');
  if (slotHash.length !== 32) throw new Error('slotHash must be exactly 32 bytes');
  const nonceLe = Buffer.alloc(4);
  nonceLe.writeUInt32LE(nonce >>> 0);
  return createHash('sha256')
    .update(Buffer.from(serverSeed, 'utf8'))
    .update(slotHash)
    .update(clientSeed32)
    .update(nonceLe)
    .digest();
}

/** First 8 bytes of sha256(finalEntropy || tag), big-endian u64. */
function roll(finalEntropy: Buffer, tag: Uint8Array): bigint {
  const h = createHash('sha256').update(finalEntropy).update(tag).digest();
  return new DataView(h.buffer, h.byteOffset, 8).getBigUint64(0, false);
}

export function lotteryDraw(
  serverSeed: string,
  clientSeed32: Uint8Array,
  slotHash: Uint8Array,
  nonce = 0,
): LotteryResult {
  const entropy = lotteryFinalEntropy(serverSeed, clientSeed32, slotHash, nonce);

  const pool = Array.from({ length: LOTTERY_MAIN_MAX }, (_, i) => i + 1);
  const main: number[] = [];
  for (let i = 0; i < LOTTERY_MAIN_COUNT; i++) {
    const r = Number(roll(entropy, Uint8Array.from([0x6d, i])) % BigInt(pool.length));
    main.push(pool[r]!);
    pool.splice(r, 1);
  }
  main.sort((a, b) => a - b);

  const bonus = Number(roll(entropy, Uint8Array.from([0x62])) % BigInt(LOTTERY_BONUS_MAX)) + 1;

  return { main, bonus };
}

/**
 * Deterministic stand-in slot hash for chain-disabled (play-money) mode:
 * sha256(serverSeed || ':' || clientSeed). Documented in the verifier so
 * off-chain draws stay reproducible.
 */
export function syntheticSlotHash(serverSeed: string, clientSeed: string): Buffer {
  return createHash('sha256').update(`${serverSeed}:${clientSeed}`, 'utf8').digest();
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
