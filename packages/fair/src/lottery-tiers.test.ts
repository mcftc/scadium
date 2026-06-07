import { describe, expect, it } from 'vitest';
import { LOTTERY, lotteryPrizeUsdtBase, lotteryTier } from '@scadium/shared';

describe('lotteryTier (bc.game fixed-prize rules)', () => {
  it('grand prize requires all 5 mains AND the bonus', () => {
    expect(lotteryTier(5, 1)).toBe('grand');
  });

  it('5 mains without the bonus is the second tier', () => {
    expect(lotteryTier(5, 0)).toBe('second');
  });

  it('4 mains pays regardless of the bonus', () => {
    expect(lotteryTier(4, 0)).toBe('third');
    expect(lotteryTier(4, 1)).toBe('third');
  });

  it('3 mains pays regardless of the bonus', () => {
    expect(lotteryTier(3, 0)).toBe('fourth');
    expect(lotteryTier(3, 1)).toBe('fourth');
  });

  it('2 or fewer mains pays nothing — bonus alone is worthless', () => {
    expect(lotteryTier(2, 1)).toBe('none');
    expect(lotteryTier(1, 0)).toBe('none');
    expect(lotteryTier(0, 1)).toBe('none');
    expect(lotteryTier(0, 0)).toBe('none'); // zero-match no longer earns a free ticket
  });
});

describe('lotteryPrizeUsdtBase', () => {
  const usdt = (usd: number) => BigInt(usd) * BigInt(10 ** LOTTERY.USDT_DECIMALS);

  it('maps tiers to the fixed USD prize table in 6-decimal base units', () => {
    expect(lotteryPrizeUsdtBase('grand')).toBe(usdt(100_000));
    expect(lotteryPrizeUsdtBase('second')).toBe(usdt(3_000));
    expect(lotteryPrizeUsdtBase('third')).toBe(usdt(20));
    expect(lotteryPrizeUsdtBase('fourth')).toBe(usdt(1));
  });

  it('non-paying tiers are zero', () => {
    expect(lotteryPrizeUsdtBase('none')).toBe(0n);
    expect(lotteryPrizeUsdtBase('free')).toBe(0n);
  });
});
