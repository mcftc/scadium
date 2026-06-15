import { describe, it, expect } from 'vitest';
import { assertRealMoneyReady } from './real-money-gate';

describe('assertRealMoneyReady (#49)', () => {
  it('throws when REAL_MONEY_ENABLED but unlicensed', () => {
    expect(() =>
      assertRealMoneyReady({ realMoneyEnabled: true, licensed: false, kycEnabled: true }),
    ).toThrow(/licence/i);
  });

  it('throws when REAL_MONEY_ENABLED but KYC is off', () => {
    expect(() =>
      assertRealMoneyReady({ realMoneyEnabled: true, licensed: true, kycEnabled: false }),
    ).toThrow(/kyc/i);
  });

  it('proceeds when real money is off (play-money)', () => {
    expect(() =>
      assertRealMoneyReady({ realMoneyEnabled: false, licensed: false, kycEnabled: false }),
    ).not.toThrow();
  });

  it('proceeds when real money is on with a licence + KYC', () => {
    expect(() =>
      assertRealMoneyReady({ realMoneyEnabled: true, licensed: true, kycEnabled: true }),
    ).not.toThrow();
  });
});
