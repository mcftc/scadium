'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, ShaderMaterial } from 'three';
import { NEON } from '@/components/three/palette';

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The backdrop IS the chart graticule: horizontal lines sit exactly at the
// nice multiplier altitudes (fed as uniforms — the right ruler labels the
// very same lines), vertical lines are time streaming with the world drift.
const FRAG = /* glsl */ `
  uniform float uScroll;
  uniform float uLevels[12];
  uniform int uCount;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    float xc = vWorld.x + uScroll;
    float gx = abs(fract(xc - 0.5) - 0.5) / fwidth(xc);
    float line = (1.0 - min(gx, 1.0)) * 0.7;
    for (int i = 0; i < 12; i++) {
      if (i >= uCount) break;
      float d = abs(vWorld.y - uLevels[i]) / fwidth(vWorld.y);
      line = max(line, 1.0 - min(d, 1.0));
    }
    float fade = line * smoothstep(1.0, 0.45, vUv.y) * 0.55;
    if (fade < 0.01) discard;
    gl_FragColor = vec4(uColor * fade, fade);
  }
`;

/**
 * Side-scroller staging: grid backdrop wall (the chart graticule), plain flat
 * ground, glowing horizon seam. `levelsRef` carries the world-y positions of
 * the nice multiplier lines so backdrop and ruler can never disagree.
 */
export function StageBackdrop({
  speedRef,
  levelsRef,
  groundY,
}: {
  speedRef: { current: number };
  levelsRef: { current: number[] };
  groundY: number;
}) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uScroll: { value: 0 },
          uLevels: { value: new Array(12).fill(-999) },
          uCount: { value: 0 },
          uColor: { value: new Color(NEON.purpleDeep).multiplyScalar(1.5) },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  const scroll = useRef(0);

  useFrame((_, delta) => {
    scroll.current += Math.min(delta, 1 / 30) * speedRef.current;
    material.uniforms.uScroll!.value = scroll.current;
    const levels = levelsRef.current;
    const target = material.uniforms.uLevels!.value as number[];
    for (let i = 0; i < 12; i++) target[i] = levels[i] ?? -999;
    material.uniforms.uCount!.value = Math.min(12, levels.length);
  });

  return (
    <group>
      {/* The graticule wall behind the scene */}
      <mesh position={[0, groundY + 9, -5]} material={material}>
        <planeGeometry args={[44, 18]} />
      </mesh>
      {/* Plain flat ground */}
      <mesh position={[0, groundY - 0.01, -1]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[44, 14]} />
        <meshStandardMaterial color={NEON.surface} metalness={0.3} roughness={0.85} />
      </mesh>
      {/* Glowing seam where the ground meets the backdrop */}
      <mesh position={[0, groundY, -4.9]}>
        <boxGeometry args={[44, 0.02, 0.02]} />
        <meshStandardMaterial
          color={NEON.purpleDeep}
          emissive={new Color(NEON.purpleDeep).multiplyScalar(2)}
          emissiveIntensity={1.2}
        />
      </mesh>
    </group>
  );
}
