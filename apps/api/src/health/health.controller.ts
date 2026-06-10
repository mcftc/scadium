import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Liveness vs readiness split (#15) for k8s/Helm (Phase M):
 *   GET /health/live  — liveness: process is up. NO external I/O, so a slow DB
 *                       can't get the pod killed. (GET /health aliases this.)
 *   GET /health/ready — readiness: probes Postgres (SELECT 1) AND Redis (PING);
 *                       200 only if BOTH pass, else 503 with which check failed.
 *                       Wire this as the k8s readinessProbe so a pod that can't
 *                       reach its deps stops receiving traffic.
 * All routes are excluded from the `/api/v1` global prefix (see main.ts).
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private liveness() {
    return {
      status: 'ok',
      service: 'scadium-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }

  /** Backward-compatible alias for liveness. */
  @Get()
  check() {
    return this.liveness();
  }

  @Get('live')
  live() {
    return this.liveness();
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([this.probeDatabase(), this.redis.ping()]);
    const ok = database && redis;
    res.status(ok ? 200 : 503);
    return {
      status: ok ? 'ok' : 'unavailable',
      checks: {
        database: database ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
    };
  }

  /** Postgres reachability — never throws. */
  private async probeDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
