import { describe, it, expect } from 'vitest';
import { parseLimit } from './parse-limit';

describe('parseLimit (list-endpoint DoS guard)', () => {
  it('returns the fallback for undefined/blank/non-numeric', () => {
    expect(parseLimit(undefined, 20)).toBe(20);
    expect(parseLimit('', 20)).toBe(20);
    expect(parseLimit('abc', 20)).toBe(20); // NaN → fallback, not NaN into Prisma take
    expect(parseLimit('NaN', 20)).toBe(20);
  });

  it('truncates fractional and clamps to [1, max]', () => {
    expect(parseLimit('1.5', 20)).toBe(1); // truncated, not passed as 1.5
    expect(parseLimit('0', 20)).toBe(1);
    expect(parseLimit('-5', 20)).toBe(1);
    expect(parseLimit('500', 20, 100)).toBe(100);
    expect(parseLimit('37', 20, 100)).toBe(37);
  });

  it('never returns NaN or a non-integer', () => {
    for (const raw of [undefined, '', 'abc', '1.9', '1e999', 'Infinity', '-0']) {
      const n = parseLimit(raw, 25, 50);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(50);
    }
  });
});
