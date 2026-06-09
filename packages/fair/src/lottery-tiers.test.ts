import { describe, expect, it } from 'vitest';
import {
  LOTTERY,
  USD_PER_SCAD,
  lotteryBracket,
  bulkDiscountTotal,
  lotteryPoolSplit,
  ticketPriceScadBase,
} from '@scadium/shared';

describe('lotteryBracket (PancakeSwap match-from-left rules)', () => {
  it('maps leading-match count to the highest single bracket', () => {
    expect(lotteryBracket(1)).toBe(0); // match-first-1
    expect(lotteryBracket(2)).toBe(1);
    expect(lotteryBracket(3)).toBe(2);
    expect(lotteryBracket(4)).toBe(3);
    expect(lotteryBracket(5)).toBe(4);
    expect(lotteryBracket(6)).toBe(5); // jackpot (all 6)
  });

  it('zero leading matches wins nothing', () => {
    expect(lotteryBracket(0)).toBeNull();
  });

  it('clamps an over-long match to the jackpot bracket', () => {
    expect(lotteryBracket(7)).toBe(5);
  });
});

describe('ticketPriceScadBase', () => {
  it('targets the USD price in SCAD base units at the demo rate', () => {
    // $1 at $0.10/SCAD = 10 SCAD = 10 × 10^9 base units
    expect(ticketPriceScadBase(1, 0.1)).toBe(10_000_000_000n);
    expect(ticketPriceScadBase(LOTTERY.TICKET_PRICE_USD, USD_PER_SCAD)).toBe(
      ticketPriceScadBase(),
    );
  });
});

describe('bulkDiscountTotal (PancakeSwap formula)', () => {
  const price = 10_000_000_000n; // 10 SCAD

  it('charges full price for a single ticket', () => {
    expect(bulkDiscountTotal(price, 1)).toBe(price);
  });

  it('applies the scaling discount: total = price·n·(D+1−n)/D', () => {
    const d = BigInt(LOTTERY.DISCOUNT_DIVISOR);
    for (const n of [2, 10, 50, 100]) {
      const expected = (price * BigInt(n) * (d + 1n - BigInt(n))) / d;
      expect(bulkDiscountTotal(price, n)).toBe(expected);
    }
  });

  it('discount at 100 tickets is just under 5%', () => {
    const full = price * 100n;
    const discounted = bulkDiscountTotal(price, 100);
    const savedBps = Number(((full - discounted) * 10_000n) / full);
    expect(savedBps).toBeGreaterThan(490); // ~4.95%
    expect(savedBps).toBeLessThan(500);
  });
});

describe('lotteryPoolSplit (burn off the top, rewardsBreakdown over the rest)', () => {
  it('burns 20% and splits the remaining 80% by the breakdown', () => {
    const pool = 1_000_000_000_000n; // 1,000 SCAD
    const { brackets, burn } = lotteryPoolSplit(pool);
    expect(burn).toBe((pool * 2000n) / 10_000n); // 200 SCAD
    const toWinners = pool - burn;
    LOTTERY.REWARDS_BREAKDOWN_BPS.forEach((bps, i) => {
      expect(brackets[i]).toBe((toWinners * BigInt(bps)) / 10_000n);
    });
  });

  it('matches the user-facing 1/3/6/10/20/40% of the TOTAL pool', () => {
    const pool = 1_000_000_000_000n;
    const { brackets } = lotteryPoolSplit(pool);
    const pctOfTotal = [1, 3, 6, 10, 20, 40];
    brackets.forEach((amt, i) => {
      expect(amt).toBe((pool * BigInt(pctOfTotal[i]!)) / 100n);
    });
  });

  it('breakdown sums to 10000 bps (full winner share)', () => {
    const sum = LOTTERY.REWARDS_BREAKDOWN_BPS.reduce((a, b) => a + b, 0);
    expect(sum).toBe(10_000);
  });
});
