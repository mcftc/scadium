import { buildMessage, hmacSha256 } from './hash';

/**
 * Provably-fair daily case. The prize tier is a weighted roll in [0, 1)
 * derived from the canonical HMAC primitive — same 52-bit construction as
 * crash/jackpot: the first 13 hex chars of HMAC-SHA256 are a ≤2^52 integer
 * that fits exactly in a JS number, divided by 2^52.
 */
export function dailyCaseRoll(serverSeed: string, clientSeed: string, nonce: number): number {
  const hash = hmacSha256(serverSeed, buildMessage(clientSeed, nonce));
  const h = parseInt(hash.slice(0, 13), 16);
  return h / 2 ** 52;
}

export interface CaseTier {
  tier: string;
  chance: number;
  scadBase: number;
}

/**
 * Map a roll in [0, 1) onto a prize table with cumulative-threshold semantics:
 * the FIRST entry whose `chance` exceeds the roll wins, so with tiers
 * [0.001, 0.01, 0.1, 1] a roll of 0.005 is epic (≥0.001, <0.01). The final
 * entry acts as the catch-all. Identical to the legacy Math.random() mapping —
 * the table order (rarest first, ascending chance) is part of the contract.
 */
export function pickCaseTier<T extends { chance: number }>(roll: number, tiers: readonly T[]): T {
  const last = tiers[tiers.length - 1];
  if (!last) throw new Error('pickCaseTier: empty tier table');
  return tiers.find((t) => roll < t.chance) ?? last;
}
