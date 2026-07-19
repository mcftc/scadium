import { Color } from 'three';

/** Scadium neon theme as three-ready constants (mirrors tailwind.config.ts). */
export const NEON = {
  bg: '#0A0B0F',
  surface: '#13151C',
  surfaceElevated: '#1C1F2B',
  border: '#2A2E3C',
  foreground: '#F5F3FF',
  purple: '#FFBE3D',
  purpleDeep: '#B26B0C',
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
