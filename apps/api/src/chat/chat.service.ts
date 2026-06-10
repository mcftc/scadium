import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHAT } from '@scadium/shared';
import { xpInfo } from '../users/users.service';

/**
 * Persistent chat backing store. The gateway delegates all moderation,
 * rate limiting, and persistence here so the WebSocket layer stays thin.
 *
 * Rate limiting is a REDIS sliding window (#12) keyed per user, so the limit
 * holds across ≥2 API replicas (an in-memory Map was per-pod and trivially
 * bypassed by reconnecting).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async listRecent(limit = 50) {
    const rows = await this.prisma.chatMessage.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: {
        user: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            role: true,
            totalWagered: true,
          },
        },
      },
    });
    return rows.reverse().map((m) => this.serialize(m));
  }

  async post(params: { userId: string; body: string }) {
    const trimmed = params.body.trim();
    if (!trimmed) throw new BadRequestException('Message cannot be empty');
    if (trimmed.length > CHAT.MESSAGE_MAX_LEN) {
      throw new BadRequestException(`Message too long (max ${CHAT.MESSAGE_MAX_LEN} chars)`);
    }

    await this.assertRateLimit(params.userId);

    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.banned) throw new ForbiddenException('You are banned from chat');

    // Minimal profanity redaction — swap for a dedicated lib (bad-words) when
    // we need actual moderation rather than a token filter.
    const body = trimmed.replace(/\b(fuck|shit|cunt)\b/gi, (m) => '*'.repeat(m.length));

    const row = await this.prisma.chatMessage.create({
      data: { userId: params.userId, body },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            role: true,
            totalWagered: true,
          },
        },
      },
    });

    return this.serialize(row);
  }

  async delete(params: { messageId: string; actorRole: string }) {
    if (params.actorRole !== 'admin' && params.actorRole !== 'moderator') {
      throw new ForbiddenException('Insufficient privileges');
    }
    await this.prisma.chatMessage.update({
      where: { id: params.messageId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Slide-window rate limit: at most N messages in the last W milliseconds.
   * Throws BadRequest when exceeded.
   */
  private async assertRateLimit(userId: string): Promise<void> {
    const now = Date.now();
    const window = CHAT.RATE_LIMIT_WINDOW_MS;
    const max = CHAT.RATE_LIMIT_MESSAGES;
    const key = `chat:rl:${userId}`;
    const member = `${now}-${randomBytes(6).toString('hex')}`;
    // Sliding window in a sorted set, atomically (MULTI): drop entries older
    // than the window, record this attempt, count the window, refresh the TTL.
    const res = await this.redis.client
      .multi()
      .zremrangebyscore(key, 0, now - window)
      .zadd(key, now, member)
      .zcard(key)
      .pexpire(key, window)
      .exec();
    const count = Number(res?.[2]?.[1] ?? 0); // ZCARD result (includes this attempt)
    if (count > max) {
      throw new BadRequestException('Too many messages — wait a few seconds before sending again.');
    }
  }

  private serialize(row: {
    id: string;
    body: string;
    createdAt: Date;
    user: {
      id: string;
      username: string | null;
      walletAddress: string;
      role: 'user' | 'moderator' | 'admin';
      totalWagered: bigint;
    };
  }) {
    return {
      id: row.id,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      user: {
        id: row.user.id,
        username: row.user.username,
        walletAddress: row.user.walletAddress,
        role: row.user.role,
        // solpump-style level badge next to the name.
        level: xpInfo(row.user.totalWagered).level,
      },
    };
  }
}
