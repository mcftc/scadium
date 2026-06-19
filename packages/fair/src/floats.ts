import { hmacSha256 } from './hash';

/**
 * Canonical uniform-float stream for multi-step provably-fair games (Plinko,
 * Mines, Wheel, Tower, …). Built on the same HMAC-SHA256 primitive as every
 * other game: each 32-byte block is `HMAC(serverSeed, `${clientSeed}:${nonce}:${block}`)`,
 * and each float consumes 4 bytes as a base-256 fraction in [0, 1) — the
 * Stake-style encoding. `block` increments to extend the stream indefinitely, so
 * a client with (serverSeed, clientSeed, nonce) reproduces every float exactly.
 */
export function* floatStream(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Generator<number, never, unknown> {
  let block = 0;
  for (;;) {
    const bytes = Buffer.from(hmacSha256(serverSeed, `${clientSeed}:${nonce}:${block}`), 'hex');
    for (let i = 0; i + 4 <= bytes.length; i += 4) {
      yield (
        bytes[i]! / 256 +
        bytes[i + 1]! / 256 ** 2 +
        bytes[i + 2]! / 256 ** 3 +
        bytes[i + 3]! / 256 ** 4
      );
    }
    block += 1;
  }
}

/** Pull `count` uniform floats in [0, 1) from the stream. */
export function floatsFromHmac(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  count: number,
): number[] {
  const gen = floatStream(serverSeed, clientSeed, nonce);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(gen.next().value);
  return out;
}
