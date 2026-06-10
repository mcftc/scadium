import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit HTTP only. As a global (APP_GUARD) guard, ThrottlerGuard also fires on
 * WebSocket `@SubscribeMessage` handlers (chat:send, coinflip ping), where its default
 * tracker reads `req.ips`/`req.ip` off the Socket.io client and throws — breaking realtime.
 * Skipping non-http contexts keeps throttling on the REST surface (auth, bets) without
 * touching the gateways.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.shouldSkip(context);
  }
}
