/**
 * Real-money boot gate (#49, extended #149). Real money may only be enabled once
 * a valid licence is held AND the compliance controls are active. Fail-closed:
 * throws at boot when `REAL_MONEY_ENABLED` is set without them, so the operator
 * can never flip to real money with the compliance gate incomplete.
 *
 * Geo hardening (#149): with real money on, the GeoGuard fails CLOSED on an
 * unverifiable region, so the audit IP-hash salt MUST be a private value
 * (`GEO_IP_SALT`) and a trusted-proxy secret (`GEO_PROXY_SECRET`) MUST be set —
 * without it, geo headers are trusted from any caller and the fail-closed gate
 * is bypassable by self-declaring a permitted country. If VPN detection is
 * enabled it MUST have a provider key (otherwise it silently scores 0).
 */
export function assertRealMoneyReady(state: {
  realMoneyEnabled: boolean;
  licensed: boolean;
  kycEnabled: boolean;
  geoIpSaltSet: boolean;
  geoProxySecretSet: boolean;
  vpnDetectionEnabled: boolean;
  vpnProviderConfigured: boolean;
}): void {
  if (!state.realMoneyEnabled) return;
  const missing: string[] = [];
  if (!state.licensed) {
    missing.push('a valid licence (LICENSE_NUMBER / LICENSE_REGULATOR / LICENSE_JURISDICTION)');
  }
  if (!state.kycEnabled) missing.push('KYC (KYC_ENABLED=true)');
  if (!state.geoIpSaltSet) {
    missing.push(
      'a private GEO_IP_SALT ≥32 chars (a short/placeholder salt makes audit IP hashes reversible)',
    );
  }
  if (!state.geoProxySecretSet) {
    missing.push('GEO_PROXY_SECRET (without it, geo headers are trusted from any direct caller)');
  }
  if (state.vpnDetectionEnabled && !state.vpnProviderConfigured) {
    missing.push('a VPN provider key (VPN_PROVIDER_API_KEY) since VPN_DETECTION_ENABLED=true');
  }
  if (missing.length > 0) {
    throw new Error(
      `REAL_MONEY_ENABLED=true but the compliance gate is incomplete — missing: ${missing.join('; ')}. Refusing to boot.`,
    );
  }
}
