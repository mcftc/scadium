import { describe, it, expect } from 'vitest';
import {
  gameParamsHash,
  rngEntropy,
  deriveSeedContext,
  deriveOutcome,
  padClientSeed32,
} from './index';
import { diceRoll } from './dice';
import { crashPoint } from './crash';

const SERVER = 'deadbeef'.repeat(8); // 64 hex chars (= on-chain revealed_seed[64])
const CLIENT = 'cafebabe12345678';
const SLOT = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i));

describe('gameParamsHash', () => {
  it('hashes the empty map as sha256("") and is order-independent', () => {
    expect(gameParamsHash({}).toString('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const a = gameParamsHash({ maxMultiplier: 1000, autoCashout: 2 });
    const b = gameParamsHash({ autoCashout: 2, maxMultiplier: 1000 });
    expect(a.toString('hex')).toBe(b.toString('hex'));
  });
});

describe('rngEntropy (cross-impl golden — locks TS ↔ scadium_rng program)', () => {
  // GOLDEN: identical inputs/outputs asserted in programs/scadium_rng tests.
  // Never change one without the other.
  it('folds serverSeed || slotHash || clientSeed32 || u32le(nonce) || gameParamsHash', () => {
    const entropyEmpty = rngEntropy(SERVER, padClientSeed32(CLIENT), SLOT, 0, gameParamsHash({}));
    expect(entropyEmpty.toString('hex')).toBe(
      'bc0aa9d26d2af6910346ef4fa28f912f7511e427b840e3357f795f78b9c89721',
    );
    const entropyParams = rngEntropy(
      SERVER,
      padClientSeed32(CLIENT),
      SLOT,
      0,
      gameParamsHash({ maxMultiplier: 1000, autoCashout: 2 }),
    );
    expect(entropyParams.toString('hex')).toBe(
      '2f998e3725b5e68e212d14eda33e0f75d0ce14d06e7c61d3b78e80826230c440',
    );
  });
});

describe('deriveSeedContext', () => {
  it('passes through unchanged off-chain (no onchainEntropy) — backward compatible', () => {
    const ctx = deriveSeedContext({ serverSeed: SERVER, clientSeed: CLIENT, nonce: 7 });
    expect(ctx).toEqual({ serverSeed: SERVER, clientSeed: CLIENT, nonce: 7 });
  });

  it('folds the on-chain entropy into the effective server seed when present', () => {
    const ctx = deriveSeedContext({
      serverSeed: SERVER,
      clientSeed: CLIENT,
      nonce: 0,
      onchainEntropy: SLOT,
    });
    expect(ctx.serverSeed).not.toBe(SERVER);
    expect(ctx.serverSeed).toBe(
      // = rngEntropy(SERVER, clientSeed32, SLOT, 0, sha256('')) hex
      'bc0aa9d26d2af6910346ef4fa28f912f7511e427b840e3357f795f78b9c89721',
    );
    expect(ctx.clientSeed).toBe(CLIENT);
  });
});

describe('deriveOutcome', () => {
  it('off-chain result equals calling the per-game function directly (passthrough)', () => {
    const out = deriveOutcome('dice', { serverSeed: SERVER, clientSeed: CLIENT, nonce: 3 });
    expect(out.roll).toBe(diceRoll(SERVER, CLIENT, 3));
  });

  it('on-chain result is reproducible from the folded seed (anchored & verifiable)', () => {
    const ctx = deriveSeedContext({
      serverSeed: SERVER,
      clientSeed: CLIENT,
      nonce: 0,
      onchainEntropy: SLOT,
    });
    const out = deriveOutcome('crash', {
      serverSeed: SERVER,
      clientSeed: CLIENT,
      nonce: 0,
      onchainEntropy: SLOT,
    });
    // Anyone with the revealed seed + on-chain entropy reproduces the multiplier.
    expect(out.multiplier).toBe(crashPoint(ctx.serverSeed, ctx.clientSeed, ctx.nonce));
  });
});
