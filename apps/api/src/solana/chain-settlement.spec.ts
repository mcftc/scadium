import { describe, it, expect } from 'vitest';
import { settlementMoved, type ConfirmedTxLike } from './settlement-verify';

/**
 * #26 — the API must only report a settlement as successful when the confirmed
 * transaction provably moved the expected value. `settlementMoved` is the pure
 * criteria `ChainService.settleBet` gates on.
 */
const HOUSE = 'HouseVau1t1111111111111111111111111111111111';
const OTHER = 'SomeOtherKey11111111111111111111111111111111';

const tx = (opts: {
  err?: unknown;
  keys?: string[];
  pre?: number[];
  post?: number[];
}): ConfirmedTxLike => ({
  meta: { err: opts.err ?? null, preBalances: opts.pre ?? [], postBalances: opts.post ?? [] },
  transaction: {
    message: { staticAccountKeys: (opts.keys ?? []).map((k) => ({ toBase58: () => k })) },
  },
});

describe('settlementMoved (#26)', () => {
  it('accepts a successful tx whose house delta equals the expected net (loss)', () => {
    const t = tx({ keys: [OTHER, HOUSE], pre: [5, 1_000], post: [5, 1_200] });
    expect(settlementMoved(t, HOUSE, 200n)).toBe(true);
  });

  it('accepts a win (house pays net) and a push (zero delta)', () => {
    expect(settlementMoved(tx({ keys: [HOUSE], pre: [1_000], post: [850] }), HOUSE, -150n)).toBe(true);
    expect(settlementMoved(tx({ keys: [HOUSE], pre: [1_000], post: [1_000] }), HOUSE, 0n)).toBe(true);
  });

  it('rejects a confirmed-but-FAILED tx (meta.err set)', () => {
    const t = tx({ err: { InstructionError: [0, 'Custom'] }, keys: [HOUSE], pre: [1_000], post: [1_000] });
    expect(settlementMoved(t, HOUSE, 0n)).toBe(false);
  });

  it('rejects when the moved amount differs from the claim (partial/zero transfer)', () => {
    // The old clamp's signature crime: full-amount receipt, zero movement.
    const t = tx({ keys: [HOUSE], pre: [1_000], post: [1_000] });
    expect(settlementMoved(t, HOUSE, 200n)).toBe(false);
    // Or a partial move.
    const partial = tx({ keys: [HOUSE], pre: [1_000], post: [1_050] });
    expect(settlementMoved(partial, HOUSE, 200n)).toBe(false);
  });

  it('rejects a missing tx, missing meta, or house vault absent from the keys', () => {
    expect(settlementMoved(null, HOUSE, 0n)).toBe(false);
    expect(settlementMoved({ meta: null }, HOUSE, 0n)).toBe(false);
    expect(settlementMoved(tx({ keys: [OTHER], pre: [1], post: [1] }), HOUSE, 0n)).toBe(false);
  });

  it('supports getAccountKeys()-style (versioned) messages', () => {
    const t: ConfirmedTxLike = {
      meta: { err: null, preBalances: [700], postBalances: [900] },
      transaction: {
        message: {
          getAccountKeys: () => ({ staticAccountKeys: [{ toBase58: () => HOUSE }] }),
        },
      },
    };
    expect(settlementMoved(t, HOUSE, 200n)).toBe(true);
  });
});
