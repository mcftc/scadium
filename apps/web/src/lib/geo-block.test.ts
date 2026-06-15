import { describe, it, expect } from 'vitest';
import { isBlockedCountry } from './geo-block';

/**
 * #43 — the edge middleware redirects blocked-country visitors to /restricted.
 * This unit-tests the blocking decision (the runnable part); the full redirect
 * is covered by the Playwright e2e tracked in #142.
 */
describe('isBlockedCountry (#43)', () => {
  it('blocks countries in the shared blocklist (case-insensitive)', () => {
    expect(isBlockedCountry('US')).toBe(true);
    expect(isBlockedCountry('gb')).toBe(true);
  });

  it('allows non-blocked countries and missing values', () => {
    expect(isBlockedCountry('BR')).toBe(false);
    expect(isBlockedCountry(null)).toBe(false);
    expect(isBlockedCountry(undefined)).toBe(false);
    expect(isBlockedCountry('')).toBe(false);
  });
});
