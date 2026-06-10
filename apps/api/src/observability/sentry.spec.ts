import { describe, it, expect, beforeEach } from 'vitest';
import { initSentry, captureException, resetSentryForTests, type SentryLike } from './sentry';

const fakeClient = () => {
  const calls = { init: 0, captured: [] as { error: unknown; tags?: Record<string, string> }[] };
  const client: SentryLike = {
    init: () => void (calls.init += 1),
    captureException: (error, context) =>
      void calls.captured.push({ error, tags: context?.tags }),
  };
  return { client, calls };
};

describe('Sentry gate (#38)', () => {
  beforeEach(() => resetSentryForTests());

  it('is a no-op without SENTRY_DSN — init never called, captures dropped', () => {
    const { client, calls } = fakeClient();
    expect(initSentry(undefined, client)).toBe(false);
    captureException(new Error('boom'), 'req-1', client);
    expect(calls.init).toBe(0);
    expect(calls.captured).toHaveLength(0);
  });

  it('initializes exactly once with a DSN', () => {
    const { client, calls } = fakeClient();
    expect(initSentry('https://x@sentry.example/1', client)).toBe(true);
    expect(initSentry('https://x@sentry.example/1', client)).toBe(true); // idempotent
    expect(calls.init).toBe(1);
  });

  it('captures with the request id as a searchable tag once enabled', () => {
    const { client, calls } = fakeClient();
    initSentry('https://x@sentry.example/1', client);
    const err = new Error('explode');
    captureException(err, 'req-42', client);
    expect(calls.captured).toEqual([{ error: err, tags: { request_id: 'req-42' } }]);
  });
});
