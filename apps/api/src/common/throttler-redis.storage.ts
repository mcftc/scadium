import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';

/**
 * Redis-backed ThrottlerStorage (#34) so rate limits hold ACROSS API replicas —
 * the default in-process Map gives every pod its own counters, which an
 * attacker bypasses by spraying requests over replicas.
 *
 * Fixed window via an atomic Lua INCR+PEXPIRE: the first hit in a window sets
 * the TTL; the request is blocked while totalHits > limit until the window
 * expires. Atomicity matters — a non-Lua INCR/EXPIRE pair can leak a counter
 * with no TTL on a crash between the two commands (a permanent block).
 *
 * FAIL-OPEN: the shared RedisService client is lazy and fails fast when Redis
 * is down; a storage error must not turn into a platform-wide 429/500, so we
 * log and allow the request (availability over throttling — the same posture
 * as the readiness probe).
 */
export class ThrottlerRedisStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ThrottlerRedisStorage.name);

  // KEYS[1] = bucket key, ARGV[1] = ttl ms → [totalHits, pttlMs]
  private static readonly INCR_SCRIPT = `
    local hits = redis.call('INCR', KEYS[1])
    if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
    local pttl = redis.call('PTTL', KEYS[1])
    return { hits, pttl }
  `;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const [hits, pttl] = (await this.redis.eval(
        ThrottlerRedisStorage.INCR_SCRIPT,
        1,
        `throttle:${throttlerName}:${key}`,
        ttl,
      )) as [number, number];

      const timeToExpire = Math.max(1, Math.ceil(pttl / 1000));
      return {
        totalHits: hits,
        timeToExpire,
        isBlocked: hits > limit,
        timeToBlockExpire: timeToExpire, // blocked until the fixed window expires
      };
    } catch (e) {
      this.logger.warn(`throttler storage unavailable — failing open: ${(e as Error).message}`);
      return { totalHits: 1, timeToExpire: 1, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
