import { createHash } from 'node:crypto';

/**
 * Provably-fair lottery draw (PancakeSwap-v2 style): a single 6-digit winning
 * number, each digit 0..9, derived deterministically from the committed seed
 * pair AND a Solana slot hash that did not exist at commit time. A ticket is a
 * 6-digit pick; it wins the highest bracket whose leading digits all match the
 * winning number, LEFT-TO-RIGHT in order (match-first-1 .. match-first-6).
 * Reproducible by anyone via the /fairness verifier, and re-derived INSIDE the
 * on-chain program at reveal (the cosigner cannot pick the number).
 *
 * Canonical byte layout (must stay in lockstep with
 * `programs/scadium_lottery/src/lib.rs` and `apps/web/src/lib/fair-browser.ts`):
 *
 *   finalEntropy = sha256( utf8(serverSeedHex64) || slotHash[32] || clientSeed32 || u32le(nonce) )
 *   digit i (0..5): h = sha256(finalEntropy || [0x64, i])   // 0x64 = 'd'
 *                   digit = u64_be(h[0..8]) % 10
 *   winning number reads digit 0 as the most-significant (leftmost) digit.
 *   encoded = 1_000_000 + value  (the leading "1" guards leading zeros, exactly
 *   like PancakeSwap's `1xxxxxx` ticket encoding).
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
export const LOTTERY_DIGITS = 6; // 6-digit ticket / winning number
export const LOTTERY_DIGIT_MAX = 10; // each digit is u64 % 10 → 0..9
export const LOTTERY_TICKET_OFFSET = 1_000_000; // encoded = OFFSET + value

export interface LotteryResult {
  digits: number[]; // 6 digits, each 0..9, index 0 = leftmost (most significant)
  encoded: number; // 1_000_000 + value (PancakeSwap-style 1xxxxxx encoding)
}

/** Zero-pad the utf8 bytes of a client-seed string to the on-chain 32-byte form. */
export function padClientSeed32(clientSeed: string): Buffer {
  const out = Buffer.alloc(32);
  Buffer.from(clientSeed, 'utf8').copy(out, 0, 0, 32);
  return out;
}

/**
 * sha256( utf8(serverSeedHex) || slotHash || clientSeed32 || u32le(nonce) ) —
 * the 32-byte entropy every digit is derived from. Exposed so callers
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

/** Encode the 6 digits to the canonical `1_000_000 + value` ticket number. */
export function encodeLotteryNumber(digits: number[]): number {
  if (digits.length !== LOTTERY_DIGITS) throw new Error('expected exactly 6 digits');
  let value = 0;
  for (const d of digits) value = value * 10 + d;
  return LOTTERY_TICKET_OFFSET + value;
}

export function lotteryDraw(
  serverSeed: string,
  clientSeed32: Uint8Array,
  slotHash: Uint8Array,
  nonce = 0,
): LotteryResult {
  const entropy = lotteryFinalEntropy(serverSeed, clientSeed32, slotHash, nonce);

  const digits: number[] = [];
  for (let i = 0; i < LOTTERY_DIGITS; i++) {
    digits.push(Number(roll(entropy, Uint8Array.from([0x64, i])) % BigInt(LOTTERY_DIGIT_MAX)));
  }

  return { digits, encoded: encodeLotteryNumber(digits) };
}

/**
 * Deterministic stand-in slot hash for chain-disabled (play-money) mode:
 * sha256(serverSeed || ':' || clientSeed). Documented in the verifier so
 * off-chain draws stay reproducible.
 */
export function syntheticSlotHash(serverSeed: string, clientSeed: string): Buffer {
  return createHash('sha256').update(`${serverSeed}:${clientSeed}`, 'utf8').digest();
}

/**
 * Count how many leading digits of a ticket match the winning number,
 * LEFT-TO-RIGHT and IN ORDER (PancakeSwap matching). Returns 0..6.
 */
export function lotteryLeadingMatch(ticketDigits: number[], drawDigits: number[]): number {
  let matched = 0;
  for (let i = 0; i < LOTTERY_DIGITS; i++) {
    if (ticketDigits[i] !== drawDigits[i]) break;
    matched++;
  }
  return matched;
}

/**
 * Highest prize bracket (0..5) a ticket qualifies for given its leading-match
 * count, or `null` if it matched zero leading digits. Bracket 0 = match-first-1,
 * bracket 5 = match-all-6 (jackpot). A ticket wins ONLY this single bracket.
 */
export function lotteryBracket(matchLen: number): number | null {
  if (matchLen < 1) return null;
  return Math.min(matchLen, LOTTERY_DIGITS) - 1;
}
