import type { Redis } from 'ioredis';

/**
 * Minimal single-holder Redis lock (`SET key token NX PX ttl`). Used to serialize
 * money-moving jobs that must not overlap across worker processes — notably
 * buy-and-burn, where two concurrent runs would read the same NGR window and
 * double-spend the cosigner. Release is token-checked so a job only frees its own
 * lock, never one a slower peer re-acquired after the ttl.
 */
export async function withRedisLock<T>(
  redis: Redis,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const token = `${process.pid}:${Date.now()}:${Math.round(performance.now())}`;
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (acquired !== 'OK') return null; // someone else holds it — skip this run
  try {
    return await fn();
  } finally {
    // Compare-and-delete so we only release our own lock.
    const release = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
    await redis.eval(release, 1, key, token).catch(() => undefined);
  }
}
