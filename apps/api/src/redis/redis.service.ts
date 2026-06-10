import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Minimal shared Redis client (#15 — readiness probe foundation; the SIWS /
 * rate-limit / worker tasks #11-#13 build on this). Lazy + non-blocking: the
 * app boots even if Redis is down (liveness stays up, readiness reports it),
 * and it reconnects quietly so readiness recovers when Redis returns.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1, // a command fails after one retry rather than hanging forever
      connectTimeout: 2000,
      retryStrategy: (times) => Math.max(100, Math.min(times * 200, 2000)), // quiet backoff; recovers when Redis returns
    });
    // Down-Redis errors are expected and probe-reported — keep them off the error log.
    this.client.on('error', (e) => this.logger.debug(`redis unavailable: ${e.message}`));
    // Kick off the initial (lazy) connection in the background; failures are fine.
    void this.client.connect().catch(() => undefined);
  }

  /**
   * Readiness probe: resolves `true` iff a PING round-trips within the timeout.
   * Never throws — a down/unreachable Redis resolves `false`.
   */
  async ping(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('redis ping timeout')), 1500);
      });
      const pong = await Promise.race([this.client.ping(), timeout]);
      return pong === 'PONG';
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
