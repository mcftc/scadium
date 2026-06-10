import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { metricsRegistry } from './metrics.registry';

/**
 * Prometheus scrape endpoint (#38). Unprefixed (`/metrics`, like `/health`) so
 * scrapers don't need the API prefix. Deliberately unauthenticated — Prometheus
 * doesn't do bearer tokens out of the box; in production keep it firewalled /
 * not proxied to the public edge (the Caddyfile only forwards the app paths).
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', metricsRegistry.contentType)
  async metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
