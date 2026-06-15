import { describe, it, expect, beforeEach } from 'vitest';
import { captureRef, getRef, clearRef } from './ref-capture';

/**
 * #47 — the web captures `?ref=CODE` on first visit and sends it on
 * /auth/verify. Runnable equivalent of the mandated Playwright e2e (#142).
 */
describe('ref capture (#47)', () => {
  beforeEach(() => window.localStorage.clear());

  it('captures a valid ?ref code and returns it for the verify call', () => {
    captureRef('?ref=ABCD1234');
    expect(getRef()).toBe('ABCD1234');
  });

  it('ignores an invalid ref code', () => {
    captureRef('?ref=%21%21');
    expect(getRef()).toBeUndefined();
  });

  it('first-write-wins (a later link does not overwrite the original referrer)', () => {
    captureRef('?ref=FIRST123');
    captureRef('?ref=SECOND99');
    expect(getRef()).toBe('FIRST123');
  });

  it('clearRef consumes the code after sign-in', () => {
    captureRef('?ref=ABCD1234');
    clearRef();
    expect(getRef()).toBeUndefined();
  });
});
