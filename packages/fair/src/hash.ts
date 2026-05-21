import { createHash, createHmac } from 'node:crypto';

/**
 * SHA-256 hex digest of a UTF-8 string.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * HMAC-SHA256 with the server seed as key and a client-controlled message.
 * This is the canonical primitive for provably-fair game results — the server
 * commits to sha256(serverSeed) before the round, reveals serverSeed after,
 * and the player can reproduce the exact result client-side.
 *
 * @param serverSeed - secret seed controlled by the server (revealed after round)
 * @param message - typically `${clientSeed}:${nonce}`
 * @returns lowercase hex digest
 */
export function hmacSha256(serverSeed: string, message: string): string {
  return createHmac('sha256', serverSeed).update(message, 'utf8').digest('hex');
}

/**
 * Build the canonical HMAC message used across all Scadium games.
 */
export function buildMessage(clientSeed: string, nonce: number): string {
  return `${clientSeed}:${nonce}`;
}
