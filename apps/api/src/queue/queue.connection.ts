import { URL } from 'node:url';
import type { ConnectionOptions } from 'bullmq';

/**
 * BullMQ connection OPTIONS parsed from `REDIS_URL`. We hand BullMQ options (not
 * a shared ioredis instance) so it owns its connection lifecycle and we avoid the
 * dual-ioredis type clash (BullMQ bundles its own copy). `maxRetriesPerRequest:
 * null` is mandatory for BullMQ's blocking commands. The app's RedisService keeps
 * its separate finite-retry client for fast readiness probes + the burn lock.
 *
 * TLS: a `rediss://` URL (e.g. Upstash) is TLS-only and SNI-routed. ioredis
 * auto-enables TLS only when handed the URL *string*; since we pass a parsed
 * options object we must set `tls` ourselves (with `servername` for SNI) or the
 * socket connects in plaintext to the TLS port and the server resets it
 * (ECONNRESET reconnect loop). Local `redis://` stays plaintext.
 */
export function queueConnection(): ConnectionOptions {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: u.hostname,
    port: Number(u.port || '6379'),
    ...(u.username ? { username: u.username } : {}),
    ...(u.password ? { password: u.password } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: { servername: u.hostname } } : {}),
    maxRetriesPerRequest: null,
  };
}
