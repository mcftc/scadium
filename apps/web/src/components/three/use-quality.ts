'use client';

import { useEffect, useState } from 'react';

export type QualityTier = 'off' | 'low' | 'high';

let detected: QualityTier | null = null;

function detect(): QualityTier {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return 'off';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'off';
  }
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  if (nav.connection?.saveData === true) return 'low';
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return 'low';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse && Math.min(window.innerWidth, window.innerHeight) < 600) return 'low';
  return 'high';
}

/**
 * Render-quality tier for 3D stages. `null` during SSR and the first client
 * paint (render the 2D fallback then); afterwards sticky for the session.
 */
export function useQualityTier(): QualityTier | null {
  const [tier, setTier] = useState<QualityTier | null>(detected);
  useEffect(() => {
    detected ??= detect();
    setTier(detected);
  }, []);
  return tier;
}
