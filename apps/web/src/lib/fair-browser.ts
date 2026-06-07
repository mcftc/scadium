/**
 * Browser-side implementation of the Scadium provably-fair engine using
 * WebCrypto (SubtleCrypto). Mirrors `@scadium/fair` exactly so a user can
 * paste seeds into the /fairness verifier and reproduce any game result
 * *without* trusting the server.
 *
 * The server uses the Node `crypto` module, the browser uses WebCrypto —
 * both must produce bit-identical HMAC-SHA256 output for the same inputs,
 * which they do by spec. Unit-tested indirectly via the E2E verifier flow.
 */

/** HMAC-SHA256(key, message) → lowercase hex digest */
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256(input) → lowercase hex */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function buildMessage(clientSeed: string, nonce: number): string {
  return `${clientSeed}:${nonce}`;
}

/**
 * Matches @scadium/fair `crashPoint` exactly. Returns the bust multiplier
 * for a round.
 */
export async function crashPoint(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Promise<number> {
  const hash = await hmacSha256Hex(serverSeed, buildMessage(clientSeed, nonce));
  const h = parseInt(hash.slice(0, 13), 16);
  if (h % 20 === 0) return 1.0;
  const e = 2 ** 52;
  return Math.floor((100 * e - h) / (e - h)) / 100;
}

/** Matches @scadium/fair `coinflipResult`. */
export async function coinflipResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Promise<'heads' | 'tails'> {
  const hash = await hmacSha256Hex(serverSeed, buildMessage(clientSeed, nonce));
  const firstByte = parseInt(hash.slice(0, 2), 16);
  return firstByte % 2 === 0 ? 'heads' : 'tails';
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const SUITS = ['H', 'D', 'C', 'S'] as const;
export type Card = { rank: (typeof RANKS)[number]; suit: (typeof SUITS)[number] };

/** Matches @scadium/fair `blackjackDeal`. */
export async function blackjackDeal(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  count: number,
): Promise<Card[]> {
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const msg = `${buildMessage(clientSeed, nonce)}:${i}`;
    const hash = await hmacSha256Hex(serverSeed, msg);
    const n = parseInt(hash.slice(0, 4), 16) % 52;
    const rank = RANKS[n % 13]!;
    const suit = SUITS[Math.floor(n / 13)]!;
    cards.push({ rank, suit });
  }
  return cards;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase().replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

/**
 * Matches @scadium/fair `lotteryDraw` — sha256-based derivation that mixes a
 * Solana slot hash into the committed seed pair (byte layout documented in
 * packages/fair/src/lottery.ts; golden-vector locked against the on-chain
 * program). `slotHashHex` is the 32-byte slot hash shown on the draw / in the
 * reveal transaction. `clientSeed` is zero-padded to the on-chain 32-byte form.
 */
export async function lotteryDraw(
  serverSeed: string,
  clientSeed: string,
  slotHashHex: string,
  nonce: number,
): Promise<{ main: number[]; bonus: number }> {
  const enc = new TextEncoder();
  const clientSeed32 = new Uint8Array(32);
  clientSeed32.set(enc.encode(clientSeed).slice(0, 32));
  const slotHash = hexToBytes(slotHashHex);
  if (slotHash.length !== 32) throw new Error('slot hash must be 32 bytes (64 hex chars)');
  const nonceLe = new Uint8Array(4);
  new DataView(nonceLe.buffer).setUint32(0, nonce >>> 0, true);

  const entropy = await sha256Bytes(
    concatBytes(enc.encode(serverSeed), slotHash, clientSeed32, nonceLe),
  );

  const roll = async (tag: number[]): Promise<bigint> => {
    const h = await sha256Bytes(concatBytes(entropy, Uint8Array.from(tag)));
    return new DataView(h.buffer, h.byteOffset, 8).getBigUint64(0, false);
  };

  const pool = Array.from({ length: 36 }, (_, i) => i + 1);
  const main: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = Number((await roll([0x6d, i])) % BigInt(pool.length));
    main.push(pool[r]!);
    pool.splice(r, 1);
  }
  main.sort((a, b) => a - b);
  const bonus = Number((await roll([0x62])) % 10n) + 1;
  return { main, bonus };
}

/**
 * Matches @scadium/fair `jackpotRoll`. The raw 52-bit roll behind a jackpot
 * draw; the winning lamport ticket is `roll % totalPotLamports`.
 */
export async function jackpotRoll(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Promise<number> {
  const hash = await hmacSha256Hex(serverSeed, buildMessage(clientSeed, nonce));
  return parseInt(hash.slice(0, 13), 16);
}

/**
 * Verify a server seed matches its committed hash. Lets the user prove the
 * server didn't swap in a different seed after the fact.
 */
export async function verifyCommit(
  serverSeed: string,
  committedHash: string,
): Promise<boolean> {
  const computed = await sha256Hex(serverSeed);
  return computed.toLowerCase() === committedHash.toLowerCase();
}
