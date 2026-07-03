import { describe, it, expect, afterEach } from 'vitest';
import { queueConnection } from './queue.connection';

/**
 * Regression: a `rediss://` URL (Upstash and any TLS-only Redis) is SNI-routed
 * and rejects plaintext. Because we hand BullMQ a parsed options object (not the
 * URL string), TLS must be set explicitly — otherwise the socket connects in
 * plaintext to the TLS port and the peer resets it in a tight ECONNRESET
 * reconnect loop, so the worker never opens its health port and Render/Fly mark
 * the deploy failed. A local `redis://` URL must stay plaintext.
 */
describe('queueConnection', () => {
  const original = process.env.REDIS_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  });

  it('enables TLS with the host as SNI servername for a rediss:// URL', () => {
    process.env.REDIS_URL = 'rediss://default:secretpass@obliging-boa-153768.upstash.io:6379';
    const c = queueConnection() as Record<string, unknown>;
    expect(c.host).toBe('obliging-boa-153768.upstash.io');
    expect(c.port).toBe(6379);
    expect(c.password).toBe('secretpass');
    expect(c.tls).toEqual({ servername: 'obliging-boa-153768.upstash.io' });
    expect(c.maxRetriesPerRequest).toBeNull();
  });

  it('does NOT set tls for a plaintext redis:// URL', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const c = queueConnection() as Record<string, unknown>;
    expect(c.host).toBe('localhost');
    expect(c.port).toBe(6379);
    expect('tls' in c).toBe(false);
    expect(c.maxRetriesPerRequest).toBeNull();
  });

  it('parses the db index from the URL path', () => {
    process.env.REDIS_URL = 'redis://localhost:6379/3';
    const c = queueConnection() as Record<string, unknown>;
    expect(c.db).toBe(3);
  });
});
