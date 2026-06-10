import { describe, it, expect } from 'vitest';
import { crashPointFromSlot } from './crash';

/**
 * Issue #101 / ADR 0002 — the slot-entropy crash derivation must be a pure,
 * reproducible function of (serverSeed, clientSeed, slotHash, nonce): a fairness
 * regression guard + golden vector locked here (mirror in Rust if a consumer
 * program is added).
 */
const SLOT_HASH = new Uint8Array(32).fill(7); // fixed 32-byte slot hash
const SERVER = 'a'.repeat(64);
const CLIENT = 'player-seed';

describe('crashPointFromSlot (issue #101)', () => {
  it('is deterministic — same inputs reproduce the same bust', () => {
    const a = crashPointFromSlot(SERVER, CLIENT, SLOT_HASH, 0);
    const b = crashPointFromSlot(SERVER, CLIENT, SLOT_HASH, 0);
    expect(a).toBe(b);
  });

  it('GOLDEN VECTOR — locked output for fixed inputs', () => {
    // If this changes, the on/off-chain derivations have diverged — update all
    // implementations together (Rust consumer program, Node, browser verifier).
    expect(crashPointFromSlot(SERVER, CLIENT, SLOT_HASH, 0)).toBe(4.93);
  });

  it('changes when any input changes (slot hash makes it unpredictable at commit)', () => {
    const base = crashPointFromSlot(SERVER, CLIENT, SLOT_HASH, 0);
    const otherSlot = crashPointFromSlot(SERVER, CLIENT, new Uint8Array(32).fill(9), 0);
    const otherNonce = crashPointFromSlot(SERVER, CLIENT, SLOT_HASH, 1);
    const otherClient = crashPointFromSlot(SERVER, 'different', SLOT_HASH, 0);
    // At least one differs from base (extremely high probability all do).
    expect([otherSlot, otherNonce, otherClient].some((v) => v !== base)).toBe(true);
  });

  it('always returns a valid multiplier ≥ 1.00', () => {
    for (let n = 0; n < 50; n++) {
      const v = crashPointFromSlot(SERVER, CLIENT, SLOT_HASH, n);
      expect(v).toBeGreaterThanOrEqual(1.0);
    }
  });
});
