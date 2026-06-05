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

/**
 * Matches @scadium/fair `lotteryDraw`. Picks 5 distinct main numbers (1..36)
 * plus one bonus (1..10) via a seeded Fisher-Yates draw — identical to the
 * server so the /fairness verifier can reproduce any lottery result.
 */
export async function lotteryDraw(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Promise<{ main: number[]; bonus: number }> {
  const pool = Array.from({ length: 36 }, (_, i) => i + 1);
  const main: number[] = [];
  for (let i = 0; i < 5; i++) {
    const hash = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:m${i}`);
    const r = parseInt(hash.slice(0, 13), 16) % pool.length;
    main.push(pool[r]!);
    pool.splice(r, 1);
  }
  main.sort((a, b) => a - b);
  const hashB = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:b`);
  const bonus = (parseInt(hashB.slice(0, 13), 16) % 10) + 1;
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
