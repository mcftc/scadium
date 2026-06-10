import { URL } from 'node:url';
import type { ConnectionOptions } from 'bullmq';

/**
 * BullMQ connection OPTIONS parsed from `REDIS_URL`. We hand BullMQ options (not
 * a shared ioredis instance) so it owns its connection lifecycle and we avoid the
 * dual-ioredis type clash (BullMQ bundles its own copy). `maxRetriesPerRequest:
 * null` is mandatory for BullMQ's blocking commands. The app's RedisService keeps
 * its separate finite-retry client for fast readiness probes + the burn lock.
 */
export function queueConnection(): ConnectionOptions {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: u.hostname,
    port: Number(u.port || '6379'),
    ...(u.username ? { username: u.username } : {}),
    ...(u.password ? { password: u.password } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    maxRetriesPerRequest: null,
  };
}
