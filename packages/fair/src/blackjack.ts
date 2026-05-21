import type { Card, Rank, Suit } from '@scadium/shared';
import { buildMessage, hmacSha256 } from './hash';

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Suit[] = ['H', 'D', 'C', 'S'];

/**
 * Deterministic card dealer for blackjack, derived from HMAC-SHA256 stream.
 * Uses the "infinite deck" model — each card is drawn independently with
 * equal probability from 52, which is mathematically equivalent to an
 * infinite reshuffled shoe.
 *
 * The card index at position `i` is:
 *   card_i = hmac(serverSeed, `${clientSeed}:${nonce}:${i}`)[0..2] % 52
 *
 * @returns `count` deterministic cards in order
 */
export function blackjackDeal(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  count: number,
): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const msg = `${buildMessage(clientSeed, nonce)}:${i}`;
    const hash = hmacSha256(serverSeed, msg);
    // Use 4 hex chars (16 bits) to reduce modulo bias on 52
    const n = parseInt(hash.slice(0, 4), 16) % 52;
    const rank = RANKS[n % 13]!;
    const suit = SUITS[Math.floor(n / 13)]!;
    cards.push({ rank, suit });
  }
  return cards;
}

/**
 * Value of a single card for blackjack hand-total calculation.
 * Aces count as 11 initially; downgrade logic lives in handValue.
 */
export function cardValue(card: Card): number {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J', '10'].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

/**
 * Compute the best (non-busting if possible) hand total for a set of cards.
 * Returns an object with the total and whether the hand is "soft" (contains
 * an Ace still counted as 11).
 */
export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  // Downgrade Aces from 11 to 1 while busting
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21;
}
