import { Color } from 'three';

/** Scadium neon theme as three-ready constants (mirrors tailwind.config.ts). */
export const NEON = {
  bg: '#0B0A14',
  surface: '#13111F',
  surfaceElevated: '#1C1930',
  border: '#2A2640',
  foreground: '#F5F3FF',
  purple: '#EE86FF',
  purpleDeep: '#6F5FCC',
  cyan: '#22D3EE',
  success: '#22C55E',
  danger: '#EF4444',
  amber: '#F59E0B',
} as const;

/**
 * Over-bright color for emissive materials. The shared bloom pass is gated at
 * luminance 1 (see NeonBloom), so only colors pushed past 1 glow — intensity
 * 2–4 is the usable range for a strong neon halo.
 */
export function emissive(hex: string, intensity = 2.5): Color {
  return new Color(hex).multiplyScalar(intensity);
}
