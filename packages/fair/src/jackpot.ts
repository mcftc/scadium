import { buildMessage, hmacSha256 } from './hash';

/**
 * Provably-fair jackpot (pot-style raffle). Every entry contributes lamports to
 * a shared pot; win probability is proportional to your share. When the round
 * closes, a committed seed pair yields a winning "ticket" in [0, totalLamports)
 * and the player whose cumulative contribution range contains it takes the pot.
 *
 * The raw roll is the first 13 hex chars of HMAC-SHA256 — a ≤2^52 integer that
 * fits exactly in a JS number, so anyone can reproduce it. The winning ticket
 * is `roll % totalLamports`.
 */
export function jackpotRoll(serverSeed: string, clientSeed: string, nonce: number): number {
  const hash = hmacSha256(serverSeed, buildMessage(clientSeed, nonce));
  return parseInt(hash.slice(0, 13), 16);
}

/** Winning lamport index in [0, totalLamports). */
export function jackpotWinningTicket(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  totalLamports: number,
): number {
  if (totalLamports <= 0) return 0;
  return jackpotRoll(serverSeed, clientSeed, nonce) % totalLamports;
}
