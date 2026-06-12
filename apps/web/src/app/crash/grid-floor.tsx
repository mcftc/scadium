'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, ShaderMaterial } from 'three';
import { NEON } from '@/components/three/palette';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Anti-aliased grid lines (fwidth), exponential fade toward the horizon,
// scrolled toward the camera at a speed the rig ties to the multiplier.
const FRAG = /* glsl */ `
  uniform float uScroll;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 cells = vUv * vec2(26.0, 30.0) + vec2(0.0, uScroll);
    vec2 grid = abs(fract(cells - 0.5) - 0.5) / fwidth(cells);
    float line = 1.0 - min(min(grid.x, grid.y), 1.0);
    float fog = smoothstep(0.95, 0.25, vUv.y);
    float fade = line * fog;
    if (fade < 0.01) discard;
    gl_FragColor = vec4(uColor * fade, fade * 0.55);
  }
`;

/**
 * Synthwave floor under the flight: a single plane + ~20 lines of GLSL.
 * Expose the scroll speed through a ref so the rig can tie it to the
 * multiplier's velocity without re-rendering.
 */
export function GridFloor({ speedRef }: { speedRef: { current: number } }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uScroll: { value: 0 },
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
    <mesh position={[0, -2.45, -4]} rotation={[-Math.PI / 2.25, 0, 0]} material={material}>
      <planeGeometry args={[36, 26]} />
    </mesh>
  );
}
