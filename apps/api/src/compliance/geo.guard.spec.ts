import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { GeoService } from './geo.service';
import { VpnDetectionService } from './vpn-detection.service';
import { GeoGuard } from './geo.guard';

const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

const ctx = (headers: Record<string, string>, ip = '203.0.113.5') =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ headers, ip, originalUrl: '/api/v1/crash/bet' }),
    }),
  }) as unknown as ExecutionContext;

const prismaStub = () => ({ geoCheck: { create: vi.fn().mockResolvedValue({}) } });

const makeGuard = (
  geoEnv: Record<string, string | undefined> = {},
  vpn = new VpnDetectionService(cfg({})),
  prisma = prismaStub(),
) => ({ guard: new GeoGuard(new GeoService(cfg(geoEnv)), vpn, prisma as never), prisma });

describe('GeoGuard (#43)', () => {
  it('blocks a request from a blocked country with 451 + audit', async () => {
    const { guard, prisma } = makeGuard();
    const err = await guard.canActivate(ctx({ 'x-vercel-ip-country': 'US' })).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(451);
    expect(prisma.geoCheck.create).toHaveBeenCalledOnce();
  });

  it('allows a request from a non-blocked country', async () => {
    const { guard } = makeGuard();
    await expect(guard.canActivate(ctx({ 'x-vercel-ip-country': 'BR' }))).resolves.toBe(true);
  });

  it('fails open (allows) when no geo header is present', async () => {
    const { guard } = makeGuard();
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
  });

  it('skips non-http (WebSocket) contexts without touching the request', async () => {
    const { guard } = makeGuard();
    const wsCtx = {
      getType: () => 'ws',
      switchToHttp: () => {
        throw new Error('switchToHttp must not be called for a ws context');
      },
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(wsCtx)).resolves.toBe(true);
  });

  it('blocks with 451 when VPN detection is on and the score exceeds the threshold', async () => {
    const vpn = new VpnDetectionService(cfg({ VPN_DETECTION_ENABLED: 'true', VPN_BLOCK_THRESHOLD: '0.5' }));
    vi.spyOn(vpn, 'score').mockResolvedValue(0.9);
    const { guard, prisma } = makeGuard({}, vpn);
    const err = await guard.canActivate(ctx({ 'x-vercel-ip-country': 'BR' })).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(451);
    expect(prisma.geoCheck.create).toHaveBeenCalled();
  });

  it('honors the BLOCKED_COUNTRIES_OVERRIDE env CSV', async () => {
    const { guard } = makeGuard({ BLOCKED_COUNTRIES_OVERRIDE: 'BR, AR' });
    // BR now blocked by override; US (default list) no longer applies.
    await expect(guard.canActivate(ctx({ 'x-vercel-ip-country': 'BR' }))).rejects.toBeInstanceOf(
      HttpException,
    );
    await expect(guard.canActivate(ctx({ 'x-vercel-ip-country': 'US' }))).resolves.toBe(true);
  });
});
