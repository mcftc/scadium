'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  MathUtils,
  Object3D,
  Vector3,
  type InstancedMesh,
  type Mesh,
} from 'three';
import { useStageRuntime } from '@/components/three/game-stage';

/**
 * Two-part exhaust:
 *  - ribbon: a fixed-vertex-count strip rewritten each frame along the last N
 *    curve points, vertex-colored white-hot → orange → transparent, additive
 *  - sparks: one InstancedMesh of GPU quads spawned at the nozzle, advanced
 *    on the CPU with ring-buffer recycling
 * The rig feeds both through refs — no React re-renders on the hot path.
 */

const RIBBON_POINTS = 26; // trail length in curve samples
const tmp = new Vector3();
const dummy = new Object3D();
const tmpColor = new Color();

const HOT = new Color('#fff7e6');
const MID = new Color('#ff9d2e');
const COOL = new Color('#ff3d00');

export interface ExhaustHandles {
  /** Rewrite the ribbon along these world-space points (tip last). */
  setRibbon: (points: Vector3[], visible: boolean) => void;
  /** Spawn sparks at the nozzle moving opposite the travel direction. */
  emit: (origin: Vector3, backDir: Vector3, count: number) => void;
}

export function ExhaustTrail({ handles }: { handles: { current: ExhaustHandles | null } }) {
  const { tier } = useStageRuntime();
  const maxSparks = tier === 'low' ? 250 : 900;
  const ribbonRef = useRef<Mesh>(null);
  const sparksRef = useRef<InstancedMesh>(null);

  // --- Ribbon: triangle strip with RIBBON_POINTS segments ----------------
  const ribbonGeometry = useMemo(() => {
    const geometry = new BufferGeometry();
    const vertexCount = RIBBON_POINTS * 2;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    geometry.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('color', new BufferAttribute(colors, 4).setUsage(DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < RIBBON_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    return geometry;
  }, []);

  // --- Sparks: ring buffer of ages/velocities ----------------------------
  const sparks = useRef({
    age: new Float32Array(maxSparks).fill(Infinity),
    vel: new Float32Array(maxSparks * 3),
    pos: new Float32Array(maxSparks * 3),
    cursor: 0,
  });

  const api = useMemo<ExhaustHandles>(
    () => ({
      setRibbon(points, visible) {
        const mesh = ribbonRef.current;
        if (!mesh) return;
        mesh.visible = visible;
        if (!visible) return;
        const position = ribbonGeometry.getAttribute('position') as BufferAttribute;
        const color = ribbonGeometry.getAttribute('color') as BufferAttribute;
        const n = Math.min(points.length, RIBBON_POINTS);
        for (let i = 0; i < RIBBON_POINTS; i++) {
          const p = points[Math.max(0, n - RIBBON_POINTS + i)] ?? points[0];
          if (!p) continue;
          const next = points[Math.min(n - 1, Math.max(1, n - RIBBON_POINTS + i + 1))] ?? p;
          // Perpendicular in the plot plane (z=0): rotate the segment direction 90°.
          tmp.set(-(next.y - p.y), next.x - p.x, 0);
          if (tmp.lengthSq() < 1e-8) tmp.set(0, 1, 0);
          tmp.normalize();
          const t = i / (RIBBON_POINTS - 1); // 0 = tail, 1 = at nozzle
          const width = 0.02 + 0.16 * Math.pow(t, 1.6);
          position.setXYZ(i * 2, p.x + tmp.x * width, p.y + tmp.y * width, p.z);
          position.setXYZ(i * 2 + 1, p.x - tmp.x * width, p.y - tmp.y * width, p.z);
          if (t > 0.75) tmpColor.copy(HOT);
          else if (t > 0.4) tmpColor.copy(MID).lerp(HOT, (t - 0.4) / 0.35);
          else tmpColor.copy(COOL).lerp(MID, t / 0.4);
          const alpha = Math.pow(t, 1.4) * 0.9;
          color.setXYZW(i * 2, tmpColor.r, tmpColor.g, tmpColor.b, alpha);
          color.setXYZW(i * 2 + 1, tmpColor.r, tmpColor.g, tmpColor.b, alpha);
        }
        position.needsUpdate = true;
        color.needsUpdate = true;
      },
      emit(origin, backDir, count) {
        const s = sparks.current;
        for (let n = 0; n < count; n++) {
          const i = s.cursor;
          s.cursor = (s.cursor + 1) % maxSparks;
          s.age[i] = 0;
          s.pos[i * 3] = origin.x;
          s.pos[i * 3 + 1] = origin.y;
          s.pos[i * 3 + 2] = origin.z;
          const spread = 0.55;
          s.vel[i * 3] = backDir.x * (1.6 + Math.random()) + (Math.random() - 0.5) * spread;
          s.vel[i * 3 + 1] = backDir.y * (1.6 + Math.random()) + (Math.random() - 0.5) * spread;
          s.vel[i * 3 + 2] = (Math.random() - 0.5) * spread * 0.6;
        }
      },
    }),
    [ribbonGeometry, maxSparks],
  );
  handles.current = api;

  useFrame((_, delta) => {
    const mesh = sparksRef.current;
    if (!mesh) return;
    const dt = Math.min(delta, 1 / 30);
    const s = sparks.current;
    const LIFE = 0.7;
    for (let i = 0; i < maxSparks; i++) {
      const age = s.age[i] ?? Infinity;
      if (age > LIFE) {
        dummy.position.set(0, -999, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      s.age[i] = age + dt;
      const t = age / LIFE;
      s.pos[i * 3] = (s.pos[i * 3] ?? 0) + (s.vel[i * 3] ?? 0) * dt;
      s.pos[i * 3 + 1] = (s.pos[i * 3 + 1] ?? 0) + (s.vel[i * 3 + 1] ?? 0) * dt;
      s.pos[i * 3 + 2] = (s.pos[i * 3 + 2] ?? 0) + (s.vel[i * 3 + 2] ?? 0) * dt;
      dummy.position.set(s.pos[i * 3] ?? 0, s.pos[i * 3 + 1] ?? 0, s.pos[i * 3 + 2] ?? 0);
      dummy.scale.setScalar(MathUtils.lerp(0.05, 0.005, t));
      dummy.rotation.set(0, 0, t * 7);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tmpColor.copy(HOT).lerp(COOL, Math.min(1, t * 1.6));
      mesh.setColorAt(i, tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <mesh ref={ribbonRef} geometry={ribbonGeometry} frustumCulled={false}>
        <meshBasicMaterial
          vertexColors
          transparent
          side={DoubleSide}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <instancedMesh ref={sparksRef} args={[undefined, undefined, maxSparks]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </>
  );
}
