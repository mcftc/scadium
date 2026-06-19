import { describe, it, expect } from 'vitest';
import { floatsFromHmac, floatStream } from './floats';
import { diceRoll } from './dice';
import { limboResult } from './limbo';
import { wheelSpin } from './wheel';
import { plinkoDrop } from './plinko';
import { mineField } from './mines';
import { hiloSequence, cardRank } from './hilo';
import { towerTraps } from './tower';

const SS = 'server-seed-abc';
const CS = 'client-seed-xyz';

describe('floatsFromHmac', () => {
  it('is deterministic and bounded in [0,1)', () => {
    const a = floatsFromHmac(SS, CS, 1, 10);
    const b = floatsFromHmac(SS, CS, 1, 10);
    expect(a).toEqual(b);
    for (const f of a) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
  it('streams more than one 32-byte block consistently', () => {
    const many = floatsFromHmac(SS, CS, 1, 20); // needs 2 blocks (8 floats/block)
    const gen = floatStream(SS, CS, 1);
    for (let i = 0; i < 20; i += 1) expect(gen.next().value).toBe(many[i]);
  });
  it('different nonce → different stream', () => {
    expect(floatsFromHmac(SS, CS, 1, 5)).not.toEqual(floatsFromHmac(SS, CS, 2, 5));
  });
});

describe('diceRoll', () => {
  it('is in [0,100) with 2-dp precision and deterministic', () => {
    for (let n = 0; n < 50; n += 1) {
      const r = diceRoll(SS, CS, n);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(100);
      expect(r * 100).toBeCloseTo(Math.round(r * 100), 6); // 2-dp precision
      expect(diceRoll(SS, CS, n)).toBe(r);
    }
  });
  it('mean over many rolls is near 50 (fair distribution)', () => {
    let sum = 0;
    const N = 4000;
    for (let n = 0; n < N; n += 1) sum += diceRoll(SS, CS, n);
    expect(Math.abs(sum / N - 50)).toBeLessThan(2);
  });
});

describe('limboResult', () => {
  it('is always >= 1.00 and deterministic', () => {
    for (let n = 0; n < 100; n += 1) {
      const m = limboResult(SS, CS, n);
      expect(m).toBeGreaterThanOrEqual(1);
      expect(limboResult(SS, CS, n)).toBe(m);
    }
  });
  it('P(result >= target) ≈ (1-edge)/target (house edge holds)', () => {
    const target = 2;
    const edge = 0.01;
    let wins = 0;
    const N = 8000;
    for (let n = 0; n < N; n += 1) if (limboResult(SS, CS, n, edge) >= target) wins += 1;
    expect(Math.abs(wins / N - (1 - edge) / target)).toBeLessThan(0.03);
  });
});

describe('wheelSpin', () => {
  it('returns an index in [0, segmentCount)', () => {
    for (let n = 0; n < 100; n += 1) {
      const i = wheelSpin(SS, CS, n, 54);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(54);
      expect(Number.isInteger(i)).toBe(true);
    }
  });
});

describe('plinkoDrop', () => {
  it('path length === rows, bin === right-count in [0,rows]', () => {
    for (let n = 0; n < 50; n += 1) {
      const { path, bin } = plinkoDrop(SS, CS, n, 16);
      expect(path).toHaveLength(16);
      expect(path.every((d) => d === 0 || d === 1)).toBe(true);
      expect(bin).toBe(path.reduce((a, b) => a + b, 0));
      expect(bin).toBeGreaterThanOrEqual(0);
      expect(bin).toBeLessThanOrEqual(16);
    }
  });
});

describe('mineField', () => {
  it('places exactly `mines` unique cells within range, sorted', () => {
    for (let n = 0; n < 50; n += 1) {
      const field = mineField(SS, CS, n, 25, 5);
      expect(field).toHaveLength(5);
      expect(new Set(field).size).toBe(5);
      expect(field.every((c) => c >= 0 && c < 25)).toBe(true);
      expect([...field].sort((a, b) => a - b)).toEqual(field);
    }
  });
  it('is deterministic for the same seed', () => {
    expect(mineField(SS, CS, 7, 25, 3)).toEqual(mineField(SS, CS, 7, 25, 3));
  });
});

describe('hiloSequence', () => {
  it('produces card indices in [0,52) and exposes ranks 0..12', () => {
    const seq = hiloSequence(SS, CS, 3, 20);
    expect(seq).toHaveLength(20);
    for (const c of seq) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(52);
      expect(cardRank(c)).toBeGreaterThanOrEqual(0);
      expect(cardRank(c)).toBeLessThan(13);
    }
  });
});

describe('towerTraps', () => {
  it('each row has exactly columns-safePerRow traps, unique and in range', () => {
    const rows = 8;
    const columns = 3;
    const safePerRow = 2;
    const layout = towerTraps(SS, CS, 4, rows, columns, safePerRow);
    expect(layout).toHaveLength(rows);
    for (const row of layout) {
      expect(row).toHaveLength(columns - safePerRow);
      expect(new Set(row).size).toBe(columns - safePerRow);
      expect(row.every((c) => c >= 0 && c < columns)).toBe(true);
    }
  });
});
