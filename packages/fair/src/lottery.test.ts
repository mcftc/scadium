import { describe, expect, it } from 'vitest';
import {
  lotteryDraw,
  lotteryFinalEntropy,
  lotteryMatches,
  padClientSeed32,
  syntheticSlotHash,
  LOTTERY_MAIN_COUNT,
  LOTTERY_MAIN_MAX,
  LOTTERY_BONUS_MAX,
} from './lottery';
import { generateClientSeed, generateServerSeed } from './seed';

/**
 * GOLDEN VECTOR — the cross-layer lockstep contract. The exact same inputs
 * and outputs are asserted in the Anchor program's Rust unit test
 * (programs/scadium_lottery/src/lib.rs) and the browser verifier
 * (apps/web/src/lib/fair-browser.ts). Never change one without the others.
 */
const GOLDEN = {
  serverSeed: 'deadbeef'.repeat(8),
  clientSeed: 'cafebabe12345678',
  slotHash: Uint8Array.from({ length: 32 }, (_, i) => i),
  nonce: 0,
  entropyHex: 'ce7775cad5c28b6fb81bb6a97692854adcd58595a0016badea8381e4fe62960d',
  main: [4, 15, 18, 19, 30],
  bonus: 2,
};

describe('lottery provably-fair draw', () => {
  it('matches the golden vector (program ⇄ TS lockstep)', () => {
    const clientSeed32 = padClientSeed32(GOLDEN.clientSeed);
    const entropy = lotteryFinalEntropy(
      GOLDEN.serverSeed,
      clientSeed32,
      GOLDEN.slotHash,
      GOLDEN.nonce,
    );
    expect(entropy.toString('hex')).toBe(GOLDEN.entropyHex);

    const { main, bonus } = lotteryDraw(
      GOLDEN.serverSeed,
      clientSeed32,
      GOLDEN.slotHash,
      GOLDEN.nonce,
    );
    expect(main).toEqual(GOLDEN.main);
    expect(bonus).toBe(GOLDEN.bonus);
  });

  it('is deterministic for identical inputs', () => {
    const cs = padClientSeed32('client');
    const sh = syntheticSlotHash('s'.repeat(64), 'client');
    const a = lotteryDraw('s'.repeat(64), cs, sh, 7);
    const b = lotteryDraw('s'.repeat(64), cs, sh, 7);
    expect(a).toEqual(b);
  });

  it('draws 5 distinct main numbers in 1..36 plus a bonus in 1..10', () => {
    const serverSeed = generateServerSeed();
    const clientSeed32 = padClientSeed32(generateClientSeed());
    const slotHash = syntheticSlotHash(serverSeed, 'x');
    for (let i = 0; i < 2000; i++) {
      const { main, bonus } = lotteryDraw(serverSeed, clientSeed32, slotHash, i);
      expect(main).toHaveLength(LOTTERY_MAIN_COUNT);
      expect(new Set(main).size).toBe(LOTTERY_MAIN_COUNT); // distinct
      for (const n of main) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(LOTTERY_MAIN_MAX);
      }
      // ascending
      expect([...main].sort((x, y) => x - y)).toEqual(main);
      expect(bonus).toBeGreaterThanOrEqual(1);
      expect(bonus).toBeLessThanOrEqual(LOTTERY_BONUS_MAX);
    }
  });

  it('differs across nonces and across slot hashes', () => {
    const serverSeed = 'b'.repeat(64);
    const cs = padClientSeed32('c');
    const sh1 = syntheticSlotHash(serverSeed, '1');
    const sh2 = syntheticSlotHash(serverSeed, '2');
    expect(lotteryDraw(serverSeed, cs, sh1, 1)).not.toEqual(lotteryDraw(serverSeed, cs, sh1, 2));
    expect(lotteryDraw(serverSeed, cs, sh1, 1)).not.toEqual(lotteryDraw(serverSeed, cs, sh2, 1));
  });

  it('rejects malformed inputs', () => {
    expect(() =>
      lotteryDraw('a'.repeat(64), new Uint8Array(31), new Uint8Array(32), 0),
    ).toThrow();
    expect(() =>
      lotteryDraw('a'.repeat(64), new Uint8Array(32), new Uint8Array(8), 0),
    ).toThrow();
  });

  it('counts matches correctly', () => {
    const m = lotteryMatches([1, 2, 3, 4, 5], 7, [3, 4, 5, 6, 7], 7);
    expect(m).toEqual({ matchedMain: 3, matchedBonus: 1 });
    const none = lotteryMatches([10, 20, 30, 31, 32], 1, [1, 2, 3, 4, 5], 9);
    expect(none).toEqual({ matchedMain: 0, matchedBonus: 0 });
  });
});
