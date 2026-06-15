import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { GeoService } from './geo.service';

const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

const LONG = 'x'.repeat(40);

describe('GeoService salt/secret gating (#149)', () => {
  it('rejects an unset, placeholder, or too-short GEO_IP_SALT', () => {
    expect(new GeoService(cfg({})).ipSaltConfigured).toBe(false);
    expect(new GeoService(cfg({ GEO_IP_SALT: 'change-me-geo-salt' })).ipSaltConfigured).toBe(false);
    expect(
      new GeoService(cfg({ GEO_IP_SALT: 'scadium-dev-geo-salt-INSECURE' })).ipSaltConfigured,
    ).toBe(false);
    expect(new GeoService(cfg({ GEO_IP_SALT: 'short' })).ipSaltConfigured).toBe(false);
  });

  it('accepts a private, sufficiently-long GEO_IP_SALT', () => {
    expect(new GeoService(cfg({ GEO_IP_SALT: LONG })).ipSaltConfigured).toBe(true);
  });

  it('reports proxySecretConfigured from GEO_PROXY_SECRET', () => {
    expect(new GeoService(cfg({})).proxySecretConfigured).toBe(false);
    expect(new GeoService(cfg({ GEO_PROXY_SECRET: 's3cr3t' })).proxySecretConfigured).toBe(true);
  });
});

describe('GeoService.headersAreTrusted (#149)', () => {
  it('trusts all headers when no proxy secret is configured (play-money)', () => {
    const geo = new GeoService(cfg({}));
    expect(geo.headersAreTrusted({})).toBe(true);
    expect(geo.headersAreTrusted({ 'x-vercel-ip-country': 'BR' })).toBe(true);
  });

  it('requires the matching secret when GEO_PROXY_SECRET is set', () => {
    const geo = new GeoService(cfg({ GEO_PROXY_SECRET: 's3cr3t' }));
    expect(geo.headersAreTrusted({})).toBe(false);
    expect(geo.headersAreTrusted({ 'x-geo-proxy-secret': 'wrong' })).toBe(false);
    expect(geo.headersAreTrusted({ 'x-geo-proxy-secret': 's3cr3t' })).toBe(true);
  });
});
