import {
  Controller,
  Get,
  Header,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { metricsRegistry } from './metrics.registry';

/**
 * Prometheus scrape endpoint (#38). Unprefixed (`/metrics`, like `/health`) so
 * scrapers don't need the API prefix.
 *
 * Defense-in-depth token gate: the edge (Caddy locally, the Cloudflare Worker in
 * production) forwards *every* path to the API, so `/metrics` is reachable on the public
 * origin — network isolation alone doesn't cover it. When `METRICS_TOKEN` is
 * set, a scrape must present it (`Authorization: Bearer <token>` or `?token=`);
 * when it's unset the endpoint stays open (backward-compatible, for private
 * networks / a Cloudflare WAF path rule). Pair with the WAF rule in prod.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  private readonly token: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('METRICS_TOKEN')?.trim() ?? '';
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', metricsRegistry.contentType)
  async metrics(
    @Headers('authorization') authHeader?: string,
    @Query('token') queryToken?: string,
  ): Promise<string> {
    if (this.token) {
      // qs can parse `?token[]=x` into an array/object — coerce to a string so a
      // malformed param fails closed with a clean 401, not a Buffer.from() 500.
      const query = typeof queryToken === 'string' ? queryToken : '';
      const presented = authHeader?.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : query;
      if (!this.constantTimeEquals(presented, this.token)) {
        throw new UnauthorizedException('metrics scrape token required');
      }
    }
    return metricsRegistry.metrics();
  }

  /** Length-independent, timing-safe token comparison. */
  private constantTimeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
