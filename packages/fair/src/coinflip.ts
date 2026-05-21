import type { CoinflipSide } from '@scadium/shared';
import { buildMessage, hmacSha256 } from './hash';

/**
 * Deterministic 50/50 coinflip result derived from HMAC-SHA256.
 * Takes the first byte (2 hex chars) of the hash; even → heads, odd → tails.
 */
export function coinflipResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): CoinflipSide {
  const hash = hmacSha256(serverSeed, buildMessage(clientSeed, nonce));
  const firstByte = parseInt(hash.slice(0, 2), 16);
  return firstByte % 2 === 0 ? 'heads' : 'tails';
}
