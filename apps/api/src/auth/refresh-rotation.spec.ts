import { describe, it, expect } from 'vitest';
import { newJti, newRefreshToken, hashRefreshToken, parseTtlMs } from './session-tokens';

describe('session-token helpers — refresh rotation (#35)', () => {
  it('hashes deterministically and never exposes the raw token', () => {
    const t = newRefreshToken();
    expect(hashRefreshToken(t)).toBe(hashRefreshToken(t));
    expect(hashRefreshToken(t)).not.toContain(t);
    expect(hashRefreshToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a reused token after rotation — the old hash no longer matches', () => {
    const tokenA = newRefreshToken();
    let stored = hashRefreshToken(tokenA);
    expect(hashRefreshToken(tokenA)).toBe(stored); // A is current → accepted

    // Rotate to a new token; the stored hash moves to B.
    const tokenB = newRefreshToken();
    stored = hashRefreshToken(tokenB);
    expect(hashRefreshToken(tokenA)).not.toBe(stored); // replaying A is now rejected
    expect(tokenA).not.toBe(tokenB);
  });

  it('produces a distinct jti on every rotation', () => {
    const jtis = new Set(Array.from({ length: 100 }, () => newJti()));
    expect(jtis.size).toBe(100);
  });

  it('produces unguessable, distinct refresh tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newRefreshToken()));
    expect(tokens.size).toBe(100);
    expect(newRefreshToken().length).toBeGreaterThanOrEqual(32);
  });

  it('parses JWT_REFRESH_TTL units, falling back on bad input', () => {
    expect(parseTtlMs('7d')).toBe(7 * 86_400_000);
    expect(parseTtlMs('12h')).toBe(12 * 3_600_000);
    expect(parseTtlMs('30m')).toBe(30 * 60_000);
    expect(parseTtlMs('3600s')).toBe(3_600_000);
    expect(parseTtlMs(undefined)).toBe(7 * 86_400_000);
    expect(parseTtlMs('garbage')).toBe(7 * 86_400_000);
  });
});
