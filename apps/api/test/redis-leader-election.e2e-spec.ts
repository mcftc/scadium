import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import IORedis from 'ioredis';
import { LeaderElection } from '../src/redis/leader-election';

/**
 * Issue #85 — exactly one of N replicas may hold the per-game lock at a time, and
 * leadership must fail over within one ttl when the holder stops renewing.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe('LeaderElection (issue #85)', () => {
  const r1 = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const r2 = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
  afterAll(async () => {
    await Promise.all([r1.quit(), r2.quit()]).catch(() => undefined);
  });

  it('exactly one of two contenders becomes leader', async () => {
    const key = `lock:test:${randomUUID()}`;
    const a = new LeaderElection(r1, key, 5_000);
    const b = new LeaderElection(r2, key, 5_000);
    const [la, lb] = await Promise.all([a.tick(), b.tick()]);
    expect([la, lb].filter(Boolean)).toHaveLength(1);
    expect(a.isLeader()).toBe(!b.isLeader());
    await Promise.all([a.stop(), b.stop()]);
  });

  it('the holder renews and keeps leadership across ticks', async () => {
    const key = `lock:test:${randomUUID()}`;
    const a = new LeaderElection(r1, key, 5_000);
    const b = new LeaderElection(r2, key, 5_000);
    await a.tick();
    expect(a.isLeader()).toBe(true);
    // b cannot steal it while a still holds + renews
    await b.tick();
    await a.tick();
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
    await Promise.all([a.stop(), b.stop()]);
  });

  it('a new leader takes over within ttl after the holder releases', async () => {
    const key = `lock:test:${randomUUID()}`;
    const a = new LeaderElection(r1, key, 1_000);
    const b = new LeaderElection(r2, key, 1_000);
    await a.tick();
    expect(a.isLeader()).toBe(true);
    await a.stop(); // releases the lock
    const took = await b.tick();
    expect(took).toBe(true);
    expect(b.isLeader()).toBe(true);
    await b.stop();
  });
});
