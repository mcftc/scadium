import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CHAT } from '@scadium/shared';
import { RedisService } from '../../src/redis/redis.service';
import { ChatService } from '../../src/chat/chat.service';
import { prisma } from '../engine-harness';

/**
 * General chat is gated on lifetime wager: only players who have wagered
 * ≥ CHAT.MIN_WAGERED_LAMPORTS (0.01 SOL equiv) may post; moderators/admins are
 * exempt. (Anti-spam — skin in the game.)
 */
describe('chat wager gate (integration, real Postgres + Redis)', () => {
  let redis: RedisService;
  let chat: ChatService;

  beforeAll(async () => {
    await prisma.$connect();
    redis = new RedisService();
    chat = new ChatService(prisma as never, redis);
  });
  afterAll(async () => {
    await redis.onModuleDestroy();
    await prisma.$disconnect();
  });

  const mkUser = (totalWagered: bigint, role: 'user' | 'moderator' | 'admin' = 'user') => {
    const id = randomUUID();
    return prisma.user.create({
      data: {
        walletAddress: `chat-${id}`,
        refCode: `chat-ref-${id}`,
        totalWagered,
        role,
      },
    });
  };

  it('rejects a user who has not wagered the minimum', async () => {
    const u = await mkUser(BigInt(CHAT.MIN_WAGERED_LAMPORTS) - 1n);
    await expect(chat.post({ userId: u.id, body: 'hello' })).rejects.toThrow(/unlock chat/i);
  });

  it('allows a user once they have wagered the minimum', async () => {
    const u = await mkUser(BigInt(CHAT.MIN_WAGERED_LAMPORTS));
    const msg = await chat.post({ userId: u.id, body: 'gm' });
    expect(msg.body).toBe('gm');
  });

  it('exempts moderators/admins regardless of wager', async () => {
    const mod = await mkUser(0n, 'moderator');
    const admin = await mkUser(0n, 'admin');
    await expect(chat.post({ userId: mod.id, body: 'mod here' })).resolves.toBeTruthy();
    await expect(chat.post({ userId: admin.id, body: 'admin here' })).resolves.toBeTruthy();
  });
});
