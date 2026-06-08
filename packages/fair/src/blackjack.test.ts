import { describe, expect, it } from 'vitest';
import {
  blackjackDeal,
  handValue,
  isBlackjack,
  isBust,
  cardValue,
  evaluate21Plus3,
  evaluatePerfectPairs,
} from './blackjack';
import type { Card } from '@scadium/shared';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('21+3 side bet evaluation', () => {
  it('detects suited trips', () => {
    expect(evaluate21Plus3(c('Q', 'H'), c('Q', 'H'), c('Q', 'H'))).toBe('suited_trips');
  });
  it('detects straight flush', () => {
    expect(evaluate21Plus3(c('5', 'S'), c('6', 'S'), c('7', 'S'))).toBe('straight_flush');
  });
  it('detects three of a kind (mixed suits)', () => {
    expect(evaluate21Plus3(c('K', 'H'), c('K', 'S'), c('K', 'D'))).toBe('three_of_a_kind');
  });
  it('detects straight (mixed suits) incl. A-2-3 and Q-K-A', () => {
    expect(evaluate21Plus3(c('9', 'H'), c('10', 'S'), c('J', 'D'))).toBe('straight');
    expect(evaluate21Plus3(c('A', 'H'), c('2', 'S'), c('3', 'D'))).toBe('straight');
    expect(evaluate21Plus3(c('Q', 'H'), c('K', 'S'), c('A', 'D'))).toBe('straight');
  });
  it('detects flush', () => {
    expect(evaluate21Plus3(c('2', 'C'), c('9', 'C'), c('K', 'C'))).toBe('flush');
  });
  it('returns none otherwise (and K-A-2 does not wrap)', () => {
    expect(evaluate21Plus3(c('2', 'H'), c('9', 'S'), c('K', 'D'))).toBe('none');
    expect(evaluate21Plus3(c('K', 'H'), c('A', 'S'), c('2', 'D'))).toBe('none');
  });
});

describe('Perfect Pairs side bet evaluation', () => {
  it('detects perfect pair (same rank + suit)', () => {
    expect(evaluatePerfectPairs(c('8', 'D'), c('8', 'D'))).toBe('perfect');
  });
  it('detects colored pair (same rank + color)', () => {
    expect(evaluatePerfectPairs(c('8', 'D'), c('8', 'H'))).toBe('colored');
    expect(evaluatePerfectPairs(c('J', 'C'), c('J', 'S'))).toBe('colored');
  });
  it('detects mixed pair (same rank, different color)', () => {
    expect(evaluatePerfectPairs(c('8', 'D'), c('8', 'S'))).toBe('mixed');
  });
  it('returns none for non-pairs', () => {
    expect(evaluatePerfectPairs(c('8', 'D'), c('9', 'D'))).toBe('none');
  });
});

describe('blackjack provably-fair engine', () => {
  it('deals deterministic cards', () => {
    const s = 'd'.repeat(64);
    const a = blackjackDeal(s, 'x', 0, 5);
    const b = blackjackDeal(s, 'x', 0, 5);
    expect(a).toEqual(b);
  });

  it('deals cards with valid ranks and suits', () => {
    const cards = blackjackDeal('e'.repeat(64), 'seed', 0, 100);
    for (const c of cards) {
      expect(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']).toContain(c.rank);
      expect(['H', 'D', 'C', 'S']).toContain(c.suit);
    }
  });

  it('computes hand value correctly', () => {
    // Ace + King = natural 21, Ace still counts as 11 → "soft" per the
    // strict definition (Ace not yet downgraded). This matches how the
    // engine needs it: if a third card came in, the Ace would downgrade.
    expect(handValue([{ rank: 'A', suit: 'H' }, { rank: 'K', suit: 'D' }])).toEqual({
      total: 21,
      soft: true,
    });
    expect(handValue([{ rank: 'A', suit: 'H' }, { rank: '6', suit: 'D' }])).toEqual({
      total: 17,
      soft: true,
    });
    // Ace downgrade: A(11)+9+5 = 25 → downgrade Ace to 1 → 15, no more aces counted high
    expect(
      handValue([
        { rank: 'A', suit: 'H' },
        { rank: '9', suit: 'D' },
        { rank: '5', suit: 'S' },
      ]),
    ).toEqual({ total: 15, soft: false });
  });

  it('detects blackjack', () => {
    expect(isBlackjack([{ rank: 'A', suit: 'H' }, { rank: 'K', suit: 'S' }])).toBe(true);
    expect(
      isBlackjack([
        { rank: '5', suit: 'H' },
        { rank: '5', suit: 'S' },
        { rank: 'A', suit: 'D' },
      ]),
    ).toBe(false);
  });

  it('detects bust', () => {
    expect(
      isBust([
        { rank: 'K', suit: 'H' },
        { rank: 'Q', suit: 'S' },
        { rank: '5', suit: 'D' },
      ]),
    ).toBe(true);
  });

  it('values face cards as 10 and aces as 11', () => {
    expect(cardValue({ rank: 'K', suit: 'H' })).toBe(10);
    expect(cardValue({ rank: 'A', suit: 'D' })).toBe(11);
    expect(cardValue({ rank: '7', suit: 'S' })).toBe(7);
  });
});
