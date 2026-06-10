import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';

type TrackedRequest = {
  headers?: Record<string, string | string[] | undefined>;
  ips?: string[];
  ip?: string;
};

/**
 * Rate-limit HTTP only. As a global (APP_GUARD) guard, ThrottlerGuard also fires on
 * WebSocket `@SubscribeMessage` handlers (chat:send, coinflip ping), where its default
 * tracker reads `req.ips`/`req.ip` off the Socket.io client and throws — breaking realtime.
 * Skipping non-http contexts keeps throttling on the REST surface (auth, bets) without
 * touching the gateways. (Chat spam is capped separately by ChatService's per-user
 * Redis sliding window, #12.)
 *
 * Tracker (#34): a signed-in caller is tracked by USER ID — verified from the bearer
 * token, so a forged/expired token can't claim someone else's bucket — making the
 * per-route limits survive IP rotation. Anonymous callers fall back to the client IP
 * (per-IP buckets require `trust proxy`, set in main.ts, so clients behind Caddy
 * aren't all collapsed onto the proxy's IP).
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  // Property injection so we don't have to mirror ThrottlerGuard's constructor.
  @Inject(JwtService)
  private readonly jwtService!: JwtService;

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.shouldSkip(context);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as TrackedRequest;
    const header = r.headers?.authorization;
    const [scheme, token] = (typeof header === 'string' ? header : '').split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) {
      try {
        const payload = this.jwtService.verify<{ typ?: string; userId?: string; sub?: string }>(
          token,
        );
        const userId = payload.userId ?? payload.sub;
        if (payload.typ === 'access' && userId) return `user:${userId}`;
      } catch {
        // Invalid/expired token → anonymous (IP) bucket; the route guard 401s it.
      }
    }
    return `ip:${r.ips?.length ? r.ips[0] : (r.ip ?? 'unknown')}`;
  }
}
