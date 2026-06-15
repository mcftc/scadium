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
  realMoneyEnabled = false,
) => ({
  guard: new GeoGuard(
    new GeoService(cfg(geoEnv)),
    vpn,
    prisma as never,
    {
      realMoneyEnabled,
    } as never,
  ),
  prisma,
});

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
    const vpn = new VpnDetectionService(
      cfg({ VPN_DETECTION_ENABLED: 'true', VPN_BLOCK_THRESHOLD: '0.5' }),
    );
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

  // ── Real-money hardening (#149) ──────────────────────────────────────────

  it('fails CLOSED (451) on an unknown region when real money is enabled', async () => {
    const { guard, prisma } = makeGuard({}, undefined, prismaStub(), true);
    const err = await guard.canActivate(ctx({})).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(451);
    expect(prisma.geoCheck.create).toHaveBeenCalledOnce();
  });

  it('still allows a verified, permitted region with real money on', async () => {
    const { guard } = makeGuard({}, undefined, prismaStub(), true);
    await expect(guard.canActivate(ctx({ 'x-vercel-ip-country': 'BR' }))).resolves.toBe(true);
  });

  it('treats geo headers as untrusted when GEO_PROXY_SECRET is set but absent/mismatched', async () => {
    // Real money on + proxy secret configured: a direct caller declaring BR but
    // without the secret is treated as unknown region → fail-closed 451.
    const { guard } = makeGuard({ GEO_PROXY_SECRET: 's3cr3t' }, undefined, prismaStub(), true);
    await expect(guard.canActivate(ctx({ 'x-vercel-ip-country': 'BR' }))).rejects.toBeInstanceOf(
      HttpException,
    );
    // With the correct secret echoed by the trusted proxy, the header is trusted.
    await expect(
      guard.canActivate(ctx({ 'x-vercel-ip-country': 'BR', 'x-geo-proxy-secret': 's3cr3t' })),
    ).resolves.toBe(true);
  });

  it('fails CLOSED (451) when the VPN provider errors and real money is on', async () => {
    const vpn = new VpnDetectionService(cfg({ VPN_DETECTION_ENABLED: 'true' }));
    vi.spyOn(vpn, 'score').mockRejectedValue(new Error('provider down'));
    const { guard } = makeGuard({}, vpn, prismaStub(), true);
    await expect(guard.canActivate(ctx({ 'x-vercel-ip-country': 'BR' }))).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('fails OPEN on a VPN provider error in the play-money demo', async () => {
    const vpn = new VpnDetectionService(cfg({ VPN_DETECTION_ENABLED: 'true' }));
    vi.spyOn(vpn, 'score').mockRejectedValue(new Error('provider down'));
    const { guard } = makeGuard({}, vpn, prismaStub(), false);
    await expect(guard.canActivate(ctx({ 'x-vercel-ip-country': 'BR' }))).resolves.toBe(true);
  });
});
