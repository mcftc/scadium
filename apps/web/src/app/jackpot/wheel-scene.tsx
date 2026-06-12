'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  MathUtils,
  Object3D,
  Shape,
  type Group,
  type InstancedMesh,
  type Mesh,
  type MeshStandardMaterial,
} from 'three';
import { ConfettiBurst } from '@/components/three/confetti-burst';
import { StageCanvas } from '@/components/three/canvas-inner';
import { NEON, emissive } from '@/components/three/palette';
import type { JackpotReveal } from './jackpot-reel';
import { drawWheelTexture, wheelLayout, WHEEL_PALETTE } from './wheel-segment-texture';

const SPIN_S = 5.2; // matches the reel's SPIN_MS
const REVS = 6;
const BULBS = 48;
const R = 2.05; // wheel radius in world units

const dummy = new Object3D();
const bulbColor = new Color();

/** The reel's deceleration feel (cubic-bezier 0.12,0.7,0.16,1 ≈ strong ease-out). */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function WheelRig({
  reveal,
  onLanded,
}: {
  reveal: JackpotReveal;
  onLanded: () => void;
}) {
  const wheel = useRef<Group>(null);
  const pointer = useRef<Group>(null);
  const winnerPop = useRef<Mesh>(null);
  const bulbs = useRef<InstancedMesh>(null);
  const elapsed = useRef(0);
  const landed = useRef(false);
  const pointerKick = useRef(0);
  const lastBoundaryAngle = useRef(0);
  const [burstId, setBurstId] = useState(0);
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);

  const layout = useMemo(() => wheelLayout(reveal.players), [reveal.players]);
  const winnerIdx = Math.max(
    0,
    reveal.players.findIndex((p) => p.userId === reveal.winnerId),
  );
  const faceTexture = useMemo(
    () => drawWheelTexture(reveal.players, layout, null),
    [reveal.players, layout],
  );

  // Final rotation: REVS full turns + put the winner's bisector under the
  // pointer. A wedge centered at θc lands at world angle θc + R, so we need
  // R ≡ π/2 − θc (mod 2π), normalized into [0, 2π) for extra forward spin.
  const finalRot = useMemo(() => {
    const center = layout.arcs[winnerIdx]?.center ?? Math.PI / 2;
    const need = MathUtils.euclideanModulo(Math.PI / 2 - center, Math.PI * 2);
    return REVS * Math.PI * 2 + need;
  }, [layout, winnerIdx]);

  // Winner pop wedge geometry (transparent until the landing).
  const popShape = useMemo(() => {
    const arc = layout.arcs[winnerIdx];
    const shape = new Shape();
    if (arc) {
      shape.moveTo(0, 0);
      shape.absarc(0, 0, R * 0.985, arc.start, arc.end, false);
      shape.closePath();
    }
    return shape;
  }, [layout, winnerIdx]);

  // Everyone-but-the-winner shade: the complement sector, shown on landing.
  const shadeRef = useRef<Mesh>(null);
  const shadeShape = useMemo(() => {
    const arc = layout.arcs[winnerIdx];
    const shape = new Shape();
    if (arc) {
      shape.moveTo(0, 0);
      shape.absarc(0, 0, R * 1.001, arc.end, arc.start + Math.PI * 2, false);
      shape.closePath();
    }
    return shape;
  }, [layout, winnerIdx]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const group = wheel.current;
    if (!group) return;
    const t = state.clock.elapsedTime;

    if (!landed.current) {
      elapsed.current += dt;
      const s = Math.min(elapsed.current / SPIN_S, 1);
      const prev = group.rotation.z;
      group.rotation.z = finalRot * easeOutQuint(s);
      // Pointer tick: kick whenever a wedge boundary sweeps past 12 o'clock.
      const sweep = group.rotation.z - prev;
      lastBoundaryAngle.current += sweep;
      const boundaryEvery = (Math.PI * 2) / Math.max(4, reveal.players.length);
      if (lastBoundaryAngle.current > boundaryEvery) {
        lastBoundaryAngle.current = 0;
        pointerKick.current = Math.min(0.5, sweep * 6 + 0.12);
      }
      if (s >= 1) {
        landed.current = true;
        setBurstId((n) => n + 1);
        if (shadeRef.current) shadeRef.current.visible = true;
        onLanded();
      }
    } else {
      // Winner celebration: the wedge pops forward and pulses.
      const pop = winnerPop.current;
      if (pop) {
        pop.visible = true;
        pop.position.z = MathUtils.damp(pop.position.z, 0.22, 6, dt);
        const material = pop.material as MeshStandardMaterial;
        material.emissiveIntensity = 1.1 + Math.sin(t * 5) * 0.5;
      }
    }

    // Pointer nudge decay.
    pointerKick.current = Math.max(0, pointerKick.current - dt * 2.4);
    if (pointer.current) pointer.current.rotation.z = -pointerKick.current;

    // Marquee bulbs chase with the spin, settle to a slow glow after.
    const mesh = bulbs.current;
    if (mesh) {
      const speed = landed.current ? 1.6 : 14 * (1 - easeOutQuint(Math.min(elapsed.current / SPIN_S, 1))) + 2;
      for (let i = 0; i < BULBS; i++) {
        const on = Math.sin(t * speed + i * 0.8) > (landed.current ? -0.2 : 0.25);
        bulbColor.set(i % 2 === 0 ? NEON.amber : NEON.purple).multiplyScalar(on ? 2.4 : 0.25);
        mesh.setColorAt(i, bulbColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Camera: gentle orbit while spinning, slight push-in once the winner
    // lands — framed so the pointer at 12 o'clock always stays in view.
    const orbit = landed.current ? 0 : Math.sin(t * 0.9) * 0.55;
    const dist = landed.current ? 6.5 : 6.9;
    camera.position.set(
      MathUtils.damp(camera.position.x, orbit, 4, dt),
      MathUtils.damp(camera.position.y, 0.4, 4, dt),
      MathUtils.damp(camera.position.z, dist, 4, dt),
    );
    camera.lookAt(0, 0.35, 0);

    invalidate(); // demand loop: this scene only lives while the reveal is up
  });

  // Hide the landing props imperatively (a declared `visible` prop would be
  // reapplied on re-renders and override the imperative toggles).
  useLayoutEffect(() => {
    if (winnerPop.current) winnerPop.current.visible = false;
    if (shadeRef.current) shadeRef.current.visible = false;
  }, []);

  // Park the bulbs on the rim BEFORE the first frame — setColorAt after the
  // material's first compile leaves three's cached program without
  // instancing-color support (foundation lesson from the confetti).
  useLayoutEffect(() => {
    const mesh = bulbs.current;
    if (!mesh) return;
    for (let i = 0; i < BULBS; i++) {
      const a = (i / BULBS) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * (R + 0.22), Math.sin(a) * (R + 0.22), 0.12);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      bulbColor.set(i % 2 === 0 ? NEON.amber : NEON.purple);
      mesh.setColorAt(i, bulbColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  const winnerColor = WHEEL_PALETTE[winnerIdx % WHEEL_PALETTE.length]!;

  return (
    <>
      {/* The wheel: face disc (single texture) + rim + hub cap */}
      <group ref={wheel}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[R, R, 0.18, 72]} />
          <meshStandardMaterial color="#161226" metalness={0.55} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0, 0.0951]} rotation={[0, 0, 0]}>
          <circleGeometry args={[R * 0.999, 72]} />
          <meshStandardMaterial
            map={faceTexture}
            emissiveMap={faceTexture}
            emissive="#ffffff"
            emissiveIntensity={0.42}
            metalness={0.3}
            roughness={0.5}
          />
        </mesh>
        {/* Winner pop wedge — hidden until the landing (imperative, no visible prop) */}
        <mesh ref={winnerPop} position={[0, 0, 0.1]}>
          <extrudeGeometry args={[popShape, { depth: 0.05, bevelEnabled: false }]} />
          <meshStandardMaterial
            color={winnerColor}
            transparent
            opacity={0.45}
            emissive={emissive(winnerColor, 1)}
            emissiveIntensity={1.2}
          />
        </mesh>
        {/* Losers' shade — dark complement sector, shown imperatively on landing */}
        <mesh ref={shadeRef} position={[0, 0, 0.097]}>
          <shapeGeometry args={[shadeShape, 48]} />
          <meshBasicMaterial color="#0B0A14" transparent opacity={0.62} depthWrite={false} />
        </mesh>
      </group>
      {/* Neon outer ring + marquee bulbs (static, don't spin with the wheel) */}
      <mesh>
        <torusGeometry args={[R + 0.22, 0.045, 12, 96]} />
        <meshStandardMaterial color={NEON.purpleDeep} metalness={0.7} roughness={0.3} />
      </mesh>
      <instancedMesh ref={bulbs} args={[undefined, undefined, BULBS]} frustumCulled={false}>
        <sphereGeometry args={[0.055, 10, 8]} />
        <meshStandardMaterial color="#1a1530" emissive="#ffffff" emissiveIntensity={1} toneMapped={false} />
      </instancedMesh>
      {/* Pointer at 12 o'clock */}
      <group position={[0, R + 0.42, 0.1]}>
        <group ref={pointer}>
          <mesh rotation={[0, 0, Math.PI]}>
            <coneGeometry args={[0.13, 0.34, 3]} />
            <meshStandardMaterial
              color={NEON.amber}
              emissive={emissive(NEON.amber, 1)}
              emissiveIntensity={1.8}
              metalness={0.5}
              roughness={0.3}
            />
          </mesh>
        </group>
      </group>
      <ConfettiBurst
        burstId={burstId}
        origin={[0, 0.6, 1.2]}
        count={400}
        power={4.2}
        gravity={3.4}
        duration={3}
        colors={[NEON.amber, '#ffd36b', NEON.purple, '#ffffff']}
      />
    </>
  );
}

export default function WheelStage({
  reveal,
  onLanded,
}: {
  reveal: JackpotReveal;
  onLanded: () => void;
}) {
  return (
    <StageCanvas frameloop="demand" camera={{ position: [0, 0.4, 6.9], fov: 42 }}>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 4, 6]} intensity={1.1} />
      <pointLight position={[-4, -2, 4]} color={NEON.cyan} intensity={4} />
      <WheelRig reveal={reveal} onLanded={onLanded} />
    </StageCanvas>
  );
}
