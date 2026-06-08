import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { TipDto } from './airdrop.controller';

/**
 * Issue #3 — `TipDto.amountLamports` must reject anything that is not a strictly
 * positive integer string (no sign, no leading zero, no decimals). This is the
 * edge-layer half of the negative-tip balance-mint fix; the engine guard and a
 * DB CHECK constraint are the other two layers.
 */
const errorsFor = (value: unknown) =>
  validate(Object.assign(new TipDto(), { amountLamports: value }));

describe('TipDto.amountLamports validation (issue #3)', () => {
  it('rejects the negative-tip exploit payload', async () => {
    expect((await errorsFor('-1000000000')).length).toBeGreaterThan(0);
  });

  it('rejects zero', async () => {
    expect((await errorsFor('0')).length).toBeGreaterThan(0);
  });

  it('rejects leading-zero, decimals, and non-numeric strings', async () => {
    expect((await errorsFor('007')).length).toBeGreaterThan(0);
    expect((await errorsFor('1.5')).length).toBeGreaterThan(0);
    expect((await errorsFor('1e9')).length).toBeGreaterThan(0);
    expect((await errorsFor('abc')).length).toBeGreaterThan(0);
    expect((await errorsFor('')).length).toBeGreaterThan(0);
  });

  it('accepts a valid positive integer lamport string', async () => {
    expect((await errorsFor('1000000')).length).toBe(0);
  });
});
