import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../src/redis/redis.service';
import { ThrottlerRedisStorage } from '../src/common/throttler-redis.storage';

/**
 * #34 — the throttler store must hold ACROSS replicas. Two ThrottlerRedisStorage
 * instances with separate Redis clients (same Redis) simulate two API pods:
 * consuming the limit on A blocks the same tracker key on B. The in-process
 * default storage FAILS this (each pod counts independently).
 */
describe('throttler Redis storage (cross-instance)', () => {
  let redisA: RedisService;
  let redisB: RedisService;
  let storageA: ThrottlerRedisStorage;
  let storageB: ThrottlerRedisStorage;

  beforeAll(() => {
    redisA = new RedisService();
    redisB = new RedisService();
    storageA = new ThrottlerRedisStorage(redisA.client);
    storageB = new ThrottlerRedisStorage(redisB.client);
  });
  afterAll(async () => {
    await redisA.onModuleDestroy();
    await redisB.onModuleDestroy();
  });

  it('consuming the limit on instance A blocks the same key on instance B', async () => {
    const key = `xinstance-${randomUUID()}`;
    const ttl = 10_000;
    const limit = 3;

    for (let i = 1; i <= limit; i++) {
      const rec = await storageA.increment(key, ttl, limit, 0, 'default');
      expect(rec.totalHits).toBe(i);
      expect(rec.isBlocked).toBe(false);
    }

    // 4th hit arrives on the OTHER pod → shared counter → blocked.
    const blocked = await storageB.increment(key, ttl, limit, 0, 'default');
    expect(blocked.totalHits).toBe(limit + 1);
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('separate tracker keys count independently', async () => {
    const ttl = 10_000;
    const a = await storageA.increment(`k-${randomUUID()}`, ttl, 3, 0, 'default');
    const b = await storageB.increment(`k-${randomUUID()}`, ttl, 3, 0, 'default');
    expect(a.totalHits).toBe(1);
    expect(b.totalHits).toBe(1);
  });
});
