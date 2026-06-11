'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, type Points } from 'three';
import { useStageRuntime } from './game-stage';
import { NEON } from './palette';

export interface StarfieldProps {
  /** Defaults by tier: 1000 high / 300 low. */
  count?: number;
  /** Inner radius of the spherical shell the stars occupy. */
  radius?: number;
  /** Shell thickness. */
  depth?: number;
  size?: number;
  opacity?: number;
  /** Slow y-rotation in rad/s. Animates only while the scene is rendering frames. */
  drift?: number;
}

export function Starfield({
  count,
  radius = 30,
  depth = 15,
  size = 0.1,
  opacity = 0.8,
  drift = 0.004,
}: StarfieldProps) {
  const { tier } = useStageRuntime();
  const starCount = count ?? (tier === 'low' ? 300 : 1000);
  const ref = useRef<Points>(null);

  const [positions, colors] = useMemo(() => {
    const pos = new Float32Array(starCount * 3);
    const col = new Float32Array(starCount * 3);
    const purple = new Color(NEON.purple);
    const cyan = new Color(NEON.cyan);
    const white = new Color(NEON.foreground);
    const tmp = new Color();
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = radius + Math.random() * depth;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const roll = Math.random();
      tmp.copy(roll < 0.12 ? purple : roll < 0.24 ? cyan : white);
      const fade = 0.45 + Math.random() * 0.55;
      col[i * 3] = tmp.r * fade;
      col[i * 3 + 1] = tmp.g * fade;
      col[i * 3 + 2] = tmp.b * fade;
    }
    return [pos, col] as const;
  }, [starCount, radius, depth]);

  useFrame((_, delta) => {
    if (drift !== 0 && ref.current) ref.current.rotation.y += drift * delta;
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry key={starCount}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        vertexColors
        transparent
        opacity={opacity}
        sizeAttenuation
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
