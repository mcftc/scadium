import { describe, it, expect } from 'vitest';
import { resolveCorsOrigins, SCADIUM_ORIGIN_RE } from './cors';

/**
 * Regression guard for the prod wallet outage: when the Render API had no
 * CORS_ORIGIN set, the browser blocked every request from https://scadium.com
 * (preflight had no Access-Control-Allow-Origin), so the wallet sign-in's first
 * call (/auth/nonce) failed and the modal showed "Failed to fetch". The
 * canonical domain must therefore be allowed regardless of the env var.
 */

/** Mirror how the `cors` package tests a request Origin against the allowlist. */
function isAllowed(origin: string, list: (string | RegExp)[]): boolean {
  return list.some((entry) => (typeof entry === 'string' ? entry === origin : entry.test(origin)));
}

describe('resolveCorsOrigins', () => {
  it('allows https://scadium.com even when CORS_ORIGIN is unset (the prod bug)', () => {
    const list = resolveCorsOrigins(undefined);
    expect(isAllowed('https://scadium.com', list)).toBe(true);
  });

  it('allows scadium.com subdomains (www / app / preview) over https only', () => {
    const list = resolveCorsOrigins('');
    expect(isAllowed('https://www.scadium.com', list)).toBe(true);
    expect(isAllowed('https://app.scadium.com', list)).toBe(true);
    // http (no TLS) and lookalike hosts must NOT match.
    expect(isAllowed('http://scadium.com', list)).toBe(false);
    expect(isAllowed('https://scadium.com.evil.com', list)).toBe(false);
    expect(isAllowed('https://notscadium.com', list)).toBe(false);
  });

  it('always allows the local dev origin', () => {
    const list = resolveCorsOrigins(undefined);
    expect(isAllowed('http://localhost:3000', list)).toBe(true);
  });

  it('merges and dedupes explicit CORS_ORIGIN entries', () => {
    const list = resolveCorsOrigins('https://staging.example.com, http://localhost:3000');
    expect(isAllowed('https://staging.example.com', list)).toBe(true);
    // localhost:3000 supplied both by default and by env → only one copy.
    const strings = list.filter((e): e is string => typeof e === 'string');
    expect(strings.filter((s) => s === 'http://localhost:3000')).toHaveLength(1);
  });

  it('SCADIUM_ORIGIN_RE is anchored (no partial matches)', () => {
    expect(SCADIUM_ORIGIN_RE.test('https://scadium.com')).toBe(true);
    expect(SCADIUM_ORIGIN_RE.test('https://scadium.com/path')).toBe(false);
    expect(SCADIUM_ORIGIN_RE.test('xhttps://scadium.com')).toBe(false);
  });
});
