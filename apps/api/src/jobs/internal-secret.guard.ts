import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * Shared-secret guard for the internal job-trigger route.
 *
 * FAILS CLOSED: when `INTERNAL_JOB_SECRET` is unset the route is denied outright
 * rather than left open. This endpoint can move money (airdrop distribution,
 * dividend rounds, buy-and-burn), so an unconfigured deployment must not expose
 * it — the opposite trade-off from `/metrics`, which is read-only and defaults open.
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  private readonly logger = new Logger(InternalSecretGuard.name);
  /** Header carrying the shared secret. Named so a Cloudflare Transform Rule can inject it. */
  static readonly HEADER = 'x-internal-secret';

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INTERNAL_JOB_SECRET;
    if (!expected) {
      this.logger.warn('INTERNAL_JOB_SECRET is unset — internal job route denied (fail closed)');
      return false;
    }
    const raw = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers[
      InternalSecretGuard.HEADER
    ];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (typeof provided !== 'string' || provided.length === 0) return false;

    // Compare over equal-length buffers so the check is constant-time; differing
    // lengths are rejected without leaking where the mismatch began.
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
