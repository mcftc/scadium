import { buildMessage, hmacSha256 } from './hash';

/**
 * Provably-fair jackpot (pot-style raffle). Every entry contributes lamports to
 * a shared pot; win probability is proportional to your share. When the round
 * closes, a committed seed pair yields a winning "ticket" in [0, totalLamports)
 * and the player whose cumulative contribution range contains it takes the pot.
 *
 * The raw roll is the FULL 256-bit HMAC-SHA256 digest read as a BigInt. The
 * winning ticket is `roll % totalLamports` computed in BigInt. A 256-bit roll
 * makes the modulo reduction uniform to within ~totalLamports / 2^256 (≈ 2^-192
 * for any realistic pot), so there is no low-ticket bias even for pots far above
 * 2^53 lamports — and BigInt end-to-end means the pot is never narrowed to a
 * lossy JS `number`. Anyone can reproduce both values from the revealed seeds.
 *
 * NOTE: this supersedes the legacy 52-bit (`hash.slice(0, 13)`) roll, which lost
 * precision and was biased toward low tickets once the pot approached 2^52. The
 * browser verifier (`apps/web/src/lib/fair-browser.ts`) mirrors this exactly.
 */
export function jackpotRoll(serverSeed: string, clientSeed: string, nonce: number): bigint {
  const hash = hmacSha256(serverSeed, buildMessage(clientSeed, nonce));
  return BigInt(`0x${hash}`);
}

/** Winning lamport index in [0, totalLamports), uniform via wide-modulus reduction. */
export function jackpotWinningTicket(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  totalLamports: bigint,
): bigint {
  if (totalLamports <= 0n) return 0n;
  return jackpotRoll(serverSeed, clientSeed, nonce) % totalLamports;
}
