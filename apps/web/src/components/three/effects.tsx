'use client';

import { Bloom, EffectComposer } from '@react-three/postprocessing';

export interface NeonBloomProps {
  intensity?: number;
  /** Luminance gate: 1 = only over-bright emissives glow (see palette.emissive). */
  threshold?: number;
}

/** The single shared postprocessing pass. High tier only — StageCanvas gates it. */
export function NeonBloom({ intensity = 0.9, threshold = 1 }: NeonBloomProps) {
  return (
    <EffectComposer>
      <Bloom
        mipmapBlur
        intensity={intensity}
        luminanceThreshold={threshold}
        luminanceSmoothing={0.15}
      />
    </EffectComposer>
  );
}
