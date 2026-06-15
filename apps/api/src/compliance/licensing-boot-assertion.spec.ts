import { describe, it, expect } from 'vitest';
import { assertRealMoneyReady } from './real-money-gate';

// A fully-ready real-money state; each test overrides one field to assert the
// specific gate. geoIpSaltSet defaults true; VPN detection off (so the provider
// key is not required) unless a test turns it on.
const ready = {
  realMoneyEnabled: true,
  licensed: true,
  kycEnabled: true,
  geoIpSaltSet: true,
  geoProxySecretSet: true,
  vpnDetectionEnabled: false,
  vpnProviderConfigured: false,
};

describe('assertRealMoneyReady (#49, #149)', () => {
  it('throws when REAL_MONEY_ENABLED but unlicensed', () => {
    expect(() => assertRealMoneyReady({ ...ready, licensed: false })).toThrow(/licence/i);
  });

  it('throws when REAL_MONEY_ENABLED but KYC is off', () => {
    expect(() => assertRealMoneyReady({ ...ready, kycEnabled: false })).toThrow(/kyc/i);
  });

  it('throws when REAL_MONEY_ENABLED but GEO_IP_SALT is unset (#149)', () => {
    expect(() => assertRealMoneyReady({ ...ready, geoIpSaltSet: false })).toThrow(/GEO_IP_SALT/);
  });

  it('throws when REAL_MONEY_ENABLED but GEO_PROXY_SECRET is unset (#149)', () => {
    expect(() => assertRealMoneyReady({ ...ready, geoProxySecretSet: false })).toThrow(
      /GEO_PROXY_SECRET/,
    );
  });

  it('throws when VPN detection is on without a provider key (#149)', () => {
    expect(() =>
      assertRealMoneyReady({ ...ready, vpnDetectionEnabled: true, vpnProviderConfigured: false }),
    ).toThrow(/VPN_PROVIDER_API_KEY/);
  });

  it('proceeds with VPN detection on AND a provider key configured', () => {
    expect(() =>
      assertRealMoneyReady({ ...ready, vpnDetectionEnabled: true, vpnProviderConfigured: true }),
    ).not.toThrow();
  });

  it('proceeds when real money is off (play-money)', () => {
    expect(() =>
      assertRealMoneyReady({
        realMoneyEnabled: false,
        licensed: false,
        kycEnabled: false,
        geoIpSaltSet: false,
        geoProxySecretSet: false,
        vpnDetectionEnabled: false,
        vpnProviderConfigured: false,
      }),
    ).not.toThrow();
  });

  it('proceeds when real money is on with all controls satisfied', () => {
    expect(() => assertRealMoneyReady({ ...ready })).not.toThrow();
  });
});
