import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CHAT } from '@scadium/shared';
import { RedisService } from '../../src/redis/redis.service';
import { ChatService } from '../../src/chat/chat.service';

/**
 * #12 — the chat rate-limit must hold ACROSS instances (shared Redis), not
 * per-pod. Two ChatService objects with separate RedisService clients (same
 * Redis) simulate two pods. Filling the window on A makes the next post on B
 * throw. FAILS on the old in-memory Map (each pod had its own counter).
 */
describe('chat rate-limit via Redis (cross-instance)', () => {
  let redisA: RedisService;
  let redisB: RedisService;
  let chatA: ChatService;
  let chatB: ChatService;

  beforeAll(() => {
    redisA = new RedisService();
    redisB = new RedisService();
    chatA = new ChatService({} as never, redisA);
    chatB = new ChatService({} as never, redisB);
  });
  afterAll(async () => {
    await redisA.onModuleDestroy();
    await redisB.onModuleDestroy();
  });

  const rateLimit = (svc: ChatService, userId: string) =>
    (svc as unknown as { assertRateLimit: (u: string) => Promise<void> }).assertRateLimit(userId);

  it('the per-user limit is shared across instances', async () => {
    const userId = randomUUID();
    // Fill the window on instance A (RATE_LIMIT_MESSAGES allowed).
    for (let i = 0; i < CHAT.RATE_LIMIT_MESSAGES; i++) {
      await expect(rateLimit(chatA, userId)).resolves.toBeUndefined();
    }
    // The next post — on a DIFFERENT instance — sees the shared count and is rejected.
    await expect(rateLimit(chatB, userId)).rejects.toThrow(/Too many messages/);
  });

  it('a different user is unaffected', async () => {
    await expect(rateLimit(chatB, randomUUID())).resolves.toBeUndefined();
  });
});
