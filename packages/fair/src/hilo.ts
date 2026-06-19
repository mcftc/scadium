import { floatsFromHmac } from './floats';

/**
 * Hi-Lo card sequence (infinite-deck model): each card is a uniform draw in
 * [0, 52). Rank = card % 13 (0 = Ace … 12 = King), suit = floor(card / 13). The
 * round commits one serverSeed; the player sees the base card, then guesses
 * higher/lower for each subsequent card, all of which are fixed in advance and
 * verifiable on reveal.
 */
export function hiloSequence(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  length: number,
): number[] {
  return floatsFromHmac(serverSeed, clientSeed, nonce, length).map((f) => Math.floor(f * 52));
}

/** Rank index 0 (Ace) … 12 (King) for a card index 0..51. */
export function cardRank(card: number): number {
  return card % 13;
}
