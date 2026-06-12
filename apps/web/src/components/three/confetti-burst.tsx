'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, MathUtils, Object3D, type InstancedMesh } from 'three';
import { useStageRuntime } from './game-stage';
import { NEON } from './palette';

interface Particle {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  scale: number;
}

export interface ConfettiBurstProps {
  /** Increment to fire a burst (0 = idle). Each new value spawns one burst. */
  burstId?: number;
  /** Defaults by tier: 220 high / 60 low. */
  count?: number;
  origin?: [number, number, number];
  /** Initial speed of the fastest particles. */
  power?: number;
  /** World-space height of a confetti piece — match it to the scene's camera distance. */
  size?: number;
  gravity?: number;
  duration?: number;
  colors?: readonly string[];
  onComplete?: () => void;
}

const dummy = new Object3D();
const tmpColor = new Color();
const DEFAULT_COLORS = [NEON.purple, NEON.cyan, NEON.foreground, NEON.amber] as const;

/** One-shot instanced confetti. Works on demand frameloops — it self-invalidates. */
export function ConfettiBurst({
  burstId = 0,
  count,
  origin = [0, 0, 0],
  power = 5,
  size = 0.16,
  gravity = 9,
  duration = 1.8,
  colors = DEFAULT_COLORS,
  onComplete,
}: ConfettiBurstProps) {
  const { tier } = useStageRuntime();
  const max = count ?? (tier === 'low' ? 60 : 220);
  const meshRef = useRef<InstancedMesh>(null);
  const particles = useRef<Particle[]>([]);
  const elapsed = useRef(0);
  const active = useRef(false);
  const lastBurst = useRef(0);
  const invalidate = useThree((state) => state.invalidate);

  // Before the first frame: park every instance at scale 0 AND create the
  // instanceColor buffer. setColorAt must happen before the material first
  // compiles — added later, three keeps the cached non-instanced-color program
  // and the mesh never draws its colors correctly.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    tmpColor.set('#ffffff');
    for (let i = 0; i < max; i++) {
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [max]);

  useEffect(() => {
    if (burstId <= 0 || burstId === lastBurst.current) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    lastBurst.current = burstId;
    const [ox, oy, oz] = origin;
    const list: Particle[] = [];
    for (let i = 0; i < max; i++) {
      const theta = Math.random() * Math.PI * 2;
      // Upward-biased hemisphere so confetti fountains rather than sprays flat.
      const up = 0.35 + Math.random() * 0.65;
      const side = Math.sqrt(Math.max(0, 1 - up * up));
      const speed = power * (0.35 + Math.random() * 0.65);
      list.push({
        px: ox,
        py: oy,
        pz: oz,
        vx: Math.cos(theta) * side * speed,
        vy: up * speed,
        vz: Math.sin(theta) * side * speed,
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        rz: Math.random() * Math.PI,
        sx: (Math.random() - 0.5) * 14,
        sy: (Math.random() - 0.5) * 14,
        sz: (Math.random() - 0.5) * 14,
        scale: 0.7 + Math.random() * 0.6,
      });
      const hex = colors[i % colors.length] ?? NEON.purple;
      mesh.setColorAt(i, tmpColor.set(hex));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    particles.current = list;
    elapsed.current = 0;
    active.current = true;
    invalidate();
  }, [burstId, max, origin, power, colors, invalidate]);

  useFrame((_, delta) => {
    if (!active.current) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    // Clamp: a throttled-tab gap otherwise teleports particles / kills the burst.
    const dt = Math.min(delta, 1 / 30);
    elapsed.current += dt;
    const t = elapsed.current;
    const fade = MathUtils.clamp(1 - t / duration, 0, 1);
    const drag = Math.max(0, 1 - 1.2 * dt);
    for (let i = 0; i < particles.current.length; i++) {
      const p = particles.current[i];
      if (!p) continue;
      p.vy -= gravity * dt;
      p.vx *= drag;
      p.vz *= drag;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.rx += p.sx * dt;
      p.ry += p.sy * dt;
      p.rz += p.sz * dt;
      dummy.position.set(p.px, p.py, p.pz);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.setScalar(p.scale * fade);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (t >= duration) {
      active.current = false;
      onComplete?.();
    } else {
      invalidate();
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, max]} frustumCulled={false}>
      <planeGeometry args={[size * 0.65, size]} />
      <meshBasicMaterial side={DoubleSide} toneMapped={false} />
    </instancedMesh>
  );
}
