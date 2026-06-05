import { describe, expect, it } from 'vitest';
import { jackpotRoll, jackpotWinningTicket } from './jackpot';
import { generateClientSeed, generateServerSeed } from './seed';

describe('jackpot provably-fair roll', () => {
  it('is deterministic for identical inputs', () => {
    const a = jackpotRoll('s'.repeat(64), 'client', 3);
    const b = jackpotRoll('s'.repeat(64), 'client', 3);
    expect(a).toBe(b);
  });

  it('produces a safe non-negative integer', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    for (let i = 0; i < 1000; i++) {
      const r = jackpotRoll(serverSeed, clientSeed, i);
      expect(Number.isSafeInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });

  it('winning ticket lands within the pot', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const total = 5_000_000_000; // 5 SOL pot
    for (let i = 0; i < 1000; i++) {
      const t = jackpotWinningTicket(serverSeed, clientSeed, i, total);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(total);
    }
  });

  it('returns 0 for an empty pot', () => {
    expect(jackpotWinningTicket('s'.repeat(64), 'c', 0, 0)).toBe(0);
  });
});
