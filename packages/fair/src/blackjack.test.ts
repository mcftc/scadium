import { describe, expect, it } from 'vitest';
import { blackjackDeal, handValue, isBlackjack, isBust, cardValue } from './blackjack';

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
