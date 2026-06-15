import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { VpnDetectionService } from './vpn-detection.service';

const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

const mockFetch = (body: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({ ok, status, json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe('VpnDetectionService (#149)', () => {
  it('reports enabled/providerConfigured from env', () => {
    const off = new VpnDetectionService(cfg({}));
    expect(off.enabled).toBe(false);
    expect(off.providerConfigured).toBe(false);
    const on = new VpnDetectionService(
      cfg({ VPN_DETECTION_ENABLED: 'true', VPN_PROVIDER_API_KEY: 'k' }),
    );
    expect(on.enabled).toBe(true);
    expect(on.providerConfigured).toBe(true);
  });

  it('returns 0 (inactive) when no provider key is configured', async () => {
    const svc = new VpnDetectionService(cfg({ VPN_DETECTION_ENABLED: 'true' }));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await svc.score('1.2.3.4')).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('scores a definitive proxy/vpn/tor verdict as 1.0', async () => {
    const svc = new VpnDetectionService(cfg({ VPN_PROVIDER_API_KEY: 'k' }));
    vi.stubGlobal('fetch', mockFetch({ success: true, proxy: true, fraud_score: 10 }));
    expect(await svc.score('1.2.3.4')).toBe(1);
  });

  it('falls back to the scaled fraud_score (0..100 → 0..1)', async () => {
    const svc = new VpnDetectionService(cfg({ VPN_PROVIDER_API_KEY: 'k' }));
    vi.stubGlobal('fetch', mockFetch({ success: true, proxy: false, vpn: false, fraud_score: 75 }));
    expect(await svc.score('1.2.3.4')).toBeCloseTo(0.75);
  });

  it('throws on a non-OK HTTP response (caller fails closed for real money)', async () => {
    const svc = new VpnDetectionService(cfg({ VPN_PROVIDER_API_KEY: 'k' }));
    vi.stubGlobal('fetch', mockFetch({}, false, 502));
    await expect(svc.score('1.2.3.4')).rejects.toThrow(/HTTP 502/);
  });

  it('throws when the provider returns success=false', async () => {
    const svc = new VpnDetectionService(cfg({ VPN_PROVIDER_API_KEY: 'k' }));
    vi.stubGlobal('fetch', mockFetch({ success: false, message: 'invalid key' }));
    await expect(svc.score('1.2.3.4')).rejects.toThrow(/success=false/);
  });
});
