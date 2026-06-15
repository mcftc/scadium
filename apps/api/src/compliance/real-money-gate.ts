/**
 * Real-money boot gate (#49). Real money may only be enabled once a valid
 * licence is held AND the compliance controls are active. Geoblocking runs via
 * the global GeoGuard (fail-open on a missing geo header — full hardening in
 * #149), so the flag-gated controls to assert here are the licence and KYC.
 * Fail-closed: throws at boot
 * when `REAL_MONEY_ENABLED` is set without them, so the operator can never flip
 * to real money with the compliance gate incomplete.
 */
export function assertRealMoneyReady(state: {
  realMoneyEnabled: boolean;
  licensed: boolean;
  kycEnabled: boolean;
}): void {
  if (!state.realMoneyEnabled) return;
  const missing: string[] = [];
  if (!state.licensed) {
    missing.push('a valid licence (LICENSE_NUMBER / LICENSE_REGULATOR / LICENSE_JURISDICTION)');
  }
  if (!state.kycEnabled) missing.push('KYC (KYC_ENABLED=true)');
  if (missing.length > 0) {
    throw new Error(
      `REAL_MONEY_ENABLED=true but the compliance gate is incomplete — missing: ${missing.join('; ')}. Refusing to boot.`,
    );
  }
}
