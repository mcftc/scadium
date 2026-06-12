'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, ShaderMaterial, Vector2 } from 'three';
import { NEON } from '@/components/three/palette';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Anti-aliased grid lines (fwidth) on a vertical BACKDROP wall, streaming
// opposite the flight heading so the world slides past the rocket. Fades out
// toward the top so the stars take over.
const FRAG = /* glsl */ `
  uniform float uScroll;
  uniform vec2 uDir;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 cells = vUv * vec2(30.0, 16.0) - uDir * uScroll;
    vec2 grid = abs(fract(cells - 0.5) - 0.5) / fwidth(cells);
    float line = 1.0 - min(min(grid.x, grid.y), 1.0);
    float fade = line * smoothstep(1.0, 0.45, vUv.y) * 0.5;
    if (fade < 0.01) discard;
    gl_FragColor = vec4(uColor * fade, fade);
  }
`;

/**
 * Side-scroller staging (per design direction): the neon grid is a backdrop
 * wall behind the action — NOT the ground — and the ground is a plain flat
 * plane with a glowing horizon seam. No camera-angle depth tricks.
 */
export function StageBackdrop({
  speedRef,
  groundY,
}: {
  speedRef: { current: number };
  groundY: number;
}) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uScroll: { value: 0 },
          uDir: { value: new Vector2(0.79, 0.62) }, // the flight heading
          uColor: { value: new Color(NEON.purpleDeep).multiplyScalar(1.4) },
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
  });

  return (
    <group>
      {/* The grid wall behind the scene */}
      <mesh position={[0, groundY + 8, -5]} material={material}>
        <planeGeometry args={[44, 16]} />
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
