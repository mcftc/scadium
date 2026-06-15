import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { prisma } from './engine-harness';
import { GeoService } from '../src/compliance/geo.service';
import { VpnDetectionService } from '../src/compliance/vpn-detection.service';
import { GeoGuard } from '../src/compliance/geo.guard';

const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

const ctx = (headers: Record<string, string>, ip: string) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ headers, ip, originalUrl: '/api/v1/crash/bet' }) }),
  }) as unknown as ExecutionContext;

describe('geo audit (#43, integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writes a GeoCheck row (allowed:false, country, hashed IP) on a blocked request', async () => {
    const geo = new GeoService(cfg({ GEO_IP_SALT: 'test-salt' }));
    const guard = new GeoGuard(
      geo,
      new VpnDetectionService(cfg({})),
      prisma as never,
      {
        realMoneyEnabled: false,
      } as never,
    );
    const rawIp = '203.0.113.7';
    const before = await prisma.geoCheck.count();

    const err = await guard
      .canActivate(ctx({ 'x-vercel-ip-country': 'US' }, rawIp))
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);

    const rows = await prisma.geoCheck.findMany({
      where: { country: 'US', allowed: false },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(rows).toHaveLength(1);
    // Raw IP is never stored — only the salted hash.
    expect(rows[0]!.ipHash).not.toBe(rawIp);
    expect(rows[0]!.ipHash).toBe(geo.hashIp(rawIp));
    expect(await prisma.geoCheck.count()).toBe(before + 1);
  });
});
