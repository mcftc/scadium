import { describe, expect, it } from 'vitest';
import {
  lotteryDraw,
  lotteryFinalEntropy,
  lotteryLeadingMatch,
  lotteryBracket,
  encodeLotteryNumber,
  padClientSeed32,
  syntheticSlotHash,
  LOTTERY_DIGITS,
  LOTTERY_DIGIT_MAX,
  LOTTERY_TICKET_OFFSET,
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
  digits: [5, 1, 9, 7, 3, 3],
  encoded: 1_519_733,
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

    const { digits, encoded } = lotteryDraw(
      GOLDEN.serverSeed,
      clientSeed32,
      GOLDEN.slotHash,
      GOLDEN.nonce,
    );
    expect(digits).toEqual(GOLDEN.digits);
    expect(encoded).toBe(GOLDEN.encoded);
    expect(encoded).toBe(LOTTERY_TICKET_OFFSET + 519_733);
  });

  it('is deterministic for identical inputs', () => {
    const cs = padClientSeed32('client');
    const sh = syntheticSlotHash('s'.repeat(64), 'client');
    const a = lotteryDraw('s'.repeat(64), cs, sh, 7);
    const b = lotteryDraw('s'.repeat(64), cs, sh, 7);
    expect(a).toEqual(b);
  });

  it('the slot hash drives the result — WHICH slot is pinned matters (#19b)', () => {
    // The on-chain program now derives from the slot PINNED at commit, not the
    // newest. Different slots ⇒ different hashes ⇒ different draws, so pinning
    // removes the cosigner's ability to grind which slot seeds the number.
    const cs = padClientSeed32(GOLDEN.clientSeed);
    const pinned = lotteryDraw(GOLDEN.serverSeed, cs, GOLDEN.slotHash, GOLDEN.nonce);
    const otherSlotHash = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff);
    const newest = lotteryDraw(GOLDEN.serverSeed, cs, otherSlotHash, GOLDEN.nonce);
    expect(pinned.digits).toEqual(GOLDEN.digits);
    expect(newest.digits).not.toEqual(pinned.digits);
  });

  it('draws 6 digits each in 0..9 with the canonical encoding', () => {
    const serverSeed = generateServerSeed();
    const clientSeed32 = padClientSeed32(generateClientSeed());
    const slotHash = syntheticSlotHash(serverSeed, 'x');
    for (let i = 0; i < 2000; i++) {
      const { digits, encoded } = lotteryDraw(serverSeed, clientSeed32, slotHash, i);
      expect(digits).toHaveLength(LOTTERY_DIGITS);
      for (const d of digits) {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(LOTTERY_DIGIT_MAX - 1);
      }
      expect(encoded).toBe(encodeLotteryNumber(digits));
      expect(encoded).toBeGreaterThanOrEqual(LOTTERY_TICKET_OFFSET);
      expect(encoded).toBeLessThan(LOTTERY_TICKET_OFFSET + 1_000_000);
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

  it('counts leading matches LEFT-TO-RIGHT and maps to the highest bracket', () => {
    const draw = [5, 1, 9, 7, 3, 3];
    // 3 leading digits match, then diverge → bracket 2 (match-first-3)
    expect(lotteryLeadingMatch([5, 1, 9, 0, 0, 0], draw)).toBe(3);
    expect(lotteryBracket(3)).toBe(2);
    // all 6 → jackpot bracket 5
    expect(lotteryLeadingMatch(draw, draw)).toBe(6);
    expect(lotteryBracket(6)).toBe(5);
    // first digit wrong → 0 matches even if later digits coincide
    expect(lotteryLeadingMatch([0, 1, 9, 7, 3, 3], draw)).toBe(0);
    expect(lotteryBracket(0)).toBeNull();
    // exactly 1 leading match → bracket 0
    expect(lotteryLeadingMatch([5, 0, 0, 0, 0, 0], draw)).toBe(1);
    expect(lotteryBracket(1)).toBe(0);
  });
});
