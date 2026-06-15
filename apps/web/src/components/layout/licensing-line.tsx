'use client';

import { useLicensing } from '@/hooks/use-licensing';

/**
 * Footer legal line. Renders the 'Licensed & regulated' style claim ONLY when a
 * real licence is configured (fail-closed via `useLicensing`) — and then shows
 * the actual regulator + licence number rather than the generic phrase. Until
 * then it shows only the honest jurisdiction notice (#41).
 */
export function LicensingLine() {
  const lic = useLicensing();
  return (
    <p>
      {lic.licensed && lic.licenseNumber && lic.regulator
        ? `Licensed by ${lic.regulator} · ${lic.licenseNumber}. Not available in restricted jurisdictions.`
        : 'Not available in restricted jurisdictions.'}
    </p>
  );
}
