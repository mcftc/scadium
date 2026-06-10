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
 * One card draw in a blackjack round's public deal order (#21). A busy table
 * draws MORE than 10 cards off one shared, monotonically increasing `deckIndex`
 * (deal pass: each seat then dealer; then hits/doubles in action order; future
 * splits open a new `handId` for the same seat). Recording every draw as
 * `{ deckIndex, dealtTo, handId }` lets any player map the deterministic stream
 * back to the exact cards a given seat/hand received.
 */
export interface DealLogEntry {
  /** Position in the deterministic `blackjackDeal` stream (0-based). */
  deckIndex: number;
  /** Seat index that received the card, or the dealer. */
  dealtTo: number | 'dealer';
  /** Stable hand id (`seat-<i>-<hand>` / `dealer`); split-ready. */
  handId: string;
  /** The dealt card — optional; `reproduceRound` re-derives it from the seed. */
  card?: Card;
}

/** A single reproduced hand: every card re-derived from the revealed seed. */
export interface ReproducedHand {
  dealtTo: number | 'dealer';
  handId: string;
  cards: Card[];
}

/**
 * Re-derive the cards for a flat list of deck indices (one hand) from the
 * revealed seed. The per-bet verifier feeds its seat's `deckIndices` here.
 */
export function reproduceHand(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  deckIndices: number[],
): Card[] {
  if (deckIndices.length === 0) return [];
  const stream = blackjackDeal(serverSeed, clientSeed, nonce, Math.max(...deckIndices) + 1);
  return deckIndices.map((i) => stream[i]!);
}

/**
 * Map a round's full deal-order log back to each seat's/hand's cards by indexing
 * the deterministic stream at the recorded `deckIndex` values — the proof that
 * the engine's seat→card mapping is honest. Hands are grouped by
 * `dealtTo`+`handId` (so splits surface as separate hands) and each hand's cards
 * are ordered by `deckIndex`. Independent of how many cards the table drew.
 */
export function reproduceRound(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  dealOrder: DealLogEntry[],
): ReproducedHand[] {
  if (dealOrder.length === 0) return [];
  const maxIndex = dealOrder.reduce((m, e) => Math.max(m, e.deckIndex), 0);
  const stream = blackjackDeal(serverSeed, clientSeed, nonce, maxIndex + 1);

  const hands = new Map<string, ReproducedHand>();
  // First-seen insertion order is preserved; cards within a hand are ordered by
  // deckIndex so out-of-order logs still reproduce the real deal sequence.
  for (const e of [...dealOrder].sort((a, b) => a.deckIndex - b.deckIndex)) {
    const key = `${e.dealtTo}|${e.handId}`;
    let hand = hands.get(key);
    if (!hand) {
      hand = { dealtTo: e.dealtTo, handId: e.handId, cards: [] };
      hands.set(key, hand);
    }
    hand.cards.push(stream[e.deckIndex]!);
  }
  return [...hands.values()];
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

// ---------- Side bets (pure functions of the dealt cards — no extra entropy) ----------

export type TwentyOnePlusThreeOutcome =
  | 'suited_trips'
  | 'straight_flush'
  | 'three_of_a_kind'
  | 'straight'
  | 'flush'
  | 'none';

export type PerfectPairsOutcome = 'perfect' | 'colored' | 'mixed' | 'none';

/** Rank order index for straight detection (A counts both low and high). */
const STRAIGHT_ORDER: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const RED_SUITS: Suit[] = ['H', 'D'];

function isStraightTriple(cards: Card[]): boolean {
  const idxs = cards.map((c) => STRAIGHT_ORDER.indexOf(c.rank)).sort((a, b) => a - b);
  if (new Set(idxs).size !== 3) return false;
  // Consecutive run, with the A-high wheel (Q K A → idx 0,11,12) also valid.
  const consecutive = idxs[2]! - idxs[0]! === 2 && idxs[1]! - idxs[0]! === 1;
  const aceHigh = idxs[0] === 0 && idxs[1] === 11 && idxs[2] === 12;
  return consecutive || aceHigh;
}

/**
 * "21+3" side bet: the player's two cards + the dealer's upcard form a
 * three-card poker hand. Deterministic — derived entirely from the committed
 * deal, so the verifier reproduces it from the same seeds.
 */
export function evaluate21Plus3(
  p1: Card,
  p2: Card,
  dealerUp: Card,
): TwentyOnePlusThreeOutcome {
  const cards = [p1, p2, dealerUp];
  const sameSuit = cards.every((c) => c.suit === cards[0]!.suit);
  const sameRank = cards.every((c) => c.rank === cards[0]!.rank);
  const straight = isStraightTriple(cards);

  if (sameRank && sameSuit) return 'suited_trips';
  if (straight && sameSuit) return 'straight_flush';
  if (sameRank) return 'three_of_a_kind';
  if (straight) return 'straight';
  if (sameSuit) return 'flush';
  return 'none';
}

/** "Perfect Pairs" side bet on the player's two cards. */
export function evaluatePerfectPairs(p1: Card, p2: Card): PerfectPairsOutcome {
  if (p1.rank !== p2.rank) return 'none';
  if (p1.suit === p2.suit) return 'perfect';
  const sameColor = RED_SUITS.includes(p1.suit) === RED_SUITS.includes(p2.suit);
  return sameColor ? 'colored' : 'mixed';
}
