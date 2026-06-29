import { describe, it, expect } from 'vitest';
import {
  HOUSE_EDGE,
  RTP,
  COINFLIP,
  CRASH,
  DICE,
  LIMBO,
  MINES,
  HILO,
  TOWER,
  WHEEL_PAYOUT_BUCKETS,
  wheelExpectedValue,
  PLINKO,
  plinkoPayouts,
  plinkoExpectedValue,
} from '@scadium/shared';

/**
 * RTP standardization guard: every house-banked game targets a 95% return (5%
 * hold) from the single `HOUSE_EDGE` source. Lottery and blackjack are EXEMPT
 * (pool/burn and rules-based edges respectively). Because all payout helpers
 * floor to 2 dp (conservative — never overpays), the realised EV sits at or just
 * below RTP; these tests lock both "never above RTP" and "close to RTP".
 */
describe('RTP standardization (95%)', () => {
  it('single source: HOUSE_EDGE = 0.05, RTP = 0.95', () => {
    expect(HOUSE_EDGE).toBe(0.05);
    expect(RTP).toBe(0.95);
  });

  it('every standardized game points its edge at HOUSE_EDGE', () => {
    expect(DICE.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(LIMBO.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(MINES.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(HILO.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(TOWER.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(COINFLIP.HOUSE_EDGE).toBe(HOUSE_EDGE);
    // Crash's edge is structural (the h%20 instant-bust = 1/20 = 5%); the
    // constant must not drift from the formula it documents.
    expect(CRASH.HOUSE_EDGE).toBe(HOUSE_EDGE);
    expect(CRASH.INSTANT_BUST_CHANCE).toBe(HOUSE_EDGE); // 1/20 === 0.05
  });

  it('coinflip pays 2 × RTP = 1.9× (5% taken upfront)', () => {
    expect(COINFLIP.PAYOUT_MULTIPLIER).toBe(1.9);
    expect(COINFLIP.PAYOUT_MULTIPLIER).toBe(Math.round(2 * RTP * 100) / 100);
  });

  it('wheel EV equals RTP (scaled buckets, floored)', () => {
    const ev = wheelExpectedValue(WHEEL_PAYOUT_BUCKETS);
    expect(ev).toBeLessThanOrEqual(RTP + 1e-9);
    expect(ev).toBeGreaterThan(RTP - 0.02);
  });

  it('plinko EV equals RTP for every row count (scaled, floored)', () => {
    for (const rows of PLINKO.ROWS) {
      const payouts = plinkoPayouts(rows)!;
      const ev = plinkoExpectedValue(payouts);
      expect(ev, `rows=${rows}`).toBeLessThanOrEqual(RTP + 1e-9);
      expect(ev, `rows=${rows}`).toBeGreaterThan(RTP - 0.02);
    }
  });
});
