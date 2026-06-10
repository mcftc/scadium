import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import IORedis from 'ioredis';
import { withRedisLock } from '../src/redis/redis-lock';

/**
 * Issue #11 — the buy-and-burn job spends the cosigner, so two overlapping runs
 * must NOT both execute (that would double-spend / double-burn the same NGR
 * window). `withRedisLock` is the guard the worker wraps it in; this proves only
 * one of two concurrent holders enters the critical section.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe('withRedisLock — serializes concurrent money jobs (issue #11)', () => {
  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
  afterAll(async () => {
    await redis.quit().catch(() => undefined);
  });

  it('only one of two concurrent holders runs the critical section', async () => {
    const key = `lock:test:${randomUUID()}`;
    let entered = 0;
    const critical = async () => {
      entered += 1;
      await new Promise((r) => setTimeout(r, 150)); // hold the lock so the peer races
      return 'ran';
    };

    const [a, b] = await Promise.all([
      withRedisLock(redis, key, 5_000, critical),
      withRedisLock(redis, key, 5_000, critical),
    ]);

    expect(entered).toBe(1); // exactly one entered
    const results = [a, b].filter((r) => r === 'ran');
    expect(results).toHaveLength(1); // the other returned null (skipped)
    // Lock is released after the holder finishes.
    expect(await redis.get(key)).toBeNull();
  });

  it('a second holder can acquire once the first has released', async () => {
    const key = `lock:test:${randomUUID()}`;
    const first = await withRedisLock(redis, key, 5_000, async () => 'first');
    const second = await withRedisLock(redis, key, 5_000, async () => 'second');
    expect(first).toBe('first');
    expect(second).toBe('second');
  });
});
