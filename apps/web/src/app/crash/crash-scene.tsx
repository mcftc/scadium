'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, Vector3, type Group, type Mesh, type PerspectiveCamera } from 'three';
import { ConfettiBurst } from '@/components/three/confetti-burst';
import { StageCanvas } from '@/components/three/canvas-inner';
import { NEON, emissive } from '@/components/three/palette';
import { Starfield } from '@/components/three/starfield';
import { Rocket3D } from './crash-rocket-3d';
import { ExhaustTrail, type ExhaustHandles } from './exhaust-trail';
import { GridFloor } from './grid-floor';
import { crashAxes, sweepValues, toFrac, CURVE_STEPS } from './crash-projection';

export type CrashPhase = 'waiting' | 'running' | 'busted';

export interface CrashStageProps {
  multiplier: number;
  phase: CrashPhase;
  roundId: string | number | null;
}

// World-space plot box the normalized curve fractions map onto (camera at
// z≈7.4, fov 45 → the box fills the 16:9 frame like the SVG's 6..88% region).
const PLOT = { x0: -4.4, w: 8.6, y0: -2.3, h: 4.6 };

const CAM_BASE = new Vector3(0, 0.25, 7.4);
const lookTarget = new Vector3(0, 0, 0);
const tipWorld = new Vector3();
const backDir = new Vector3();

function fracToWorld(fx: number, fy: number, out: Vector3): Vector3 {
  return out.set(PLOT.x0 + fx * PLOT.w, PLOT.y0 + fy * PLOT.h, 0);
}

function CrashRig({ multiplier, phase, roundId }: CrashStageProps) {
  const rocketRef = useRef<Group>(null);
  const ringRef = useRef<Mesh>(null);
  const exhaust = useRef<ExhaustHandles | null>(null);
  const gridSpeed = useRef(0.4);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  // Log-space interpolation of the 20Hz ticks: extrapolate-then-correct so
  // tick corrections are imperceptible while the curve keeps moving at 60fps.
  const logTarget = useRef(0);
  const logDisplay = useRef(0);
  logTarget.current = Math.log(Math.max(1.0001, multiplier));

  const phaseRef = useRef(phase);
  const [burstId, setBurstId] = useState(0);
  const [burstOrigin, setBurstOrigin] = useState<[number, number, number]>([0, 0.4, 0]);
  const lastTip = useRef(new Vector3(0, 0.4, 0));
  const shake = useRef(0);
  const curvePoints = useMemo(
    () => Array.from({ length: CURVE_STEPS + 1 }, () => new Vector3()),
    [],
  );

  // Hidden until the first bust (imperative — see the note on the mesh below).
  useLayoutEffect(() => {
    if (ringRef.current) ringRef.current.visible = false;
  }, []);

  // Bust: freeze the display value, fire the explosion, kick the camera.
  useEffect(() => {
    if (phase === 'busted' && phaseRef.current !== 'busted') {
      setBurstOrigin([lastTip.current.x, lastTip.current.y, lastTip.current.z]);
      setBurstId((n) => n + 1);
      shake.current = 0.3;
      if (ringRef.current) {
        ringRef.current.visible = true;
        ringRef.current.scale.setScalar(0.2);
      }
    }
    if (phase === 'waiting') {
      logDisplay.current = 0;
      if (ringRef.current) ringRef.current.visible = false;
    }
    phaseRef.current = phase;
  }, [phase, roundId]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const rocket = rocketRef.current;
    if (!rocket) return;

    if (phase === 'running') {
      logDisplay.current = MathUtils.damp(logDisplay.current, logTarget.current, 12, dt);
    } else if (phase === 'busted') {
      logDisplay.current = logTarget.current; // pin to the bust point exactly
    }
    const displayM = Math.exp(logDisplay.current);
    const axes = crashAxes(displayM);

    // Curve in world space (shared sweep with the SVG renderer).
    const values = sweepValues(axes.m);
    for (let i = 0; i < values.length; i++) {
      const { fx, fy } = toFrac(values[i] ?? 1, axes);
      fracToWorld(fx, fy, curvePoints[i] ?? tipWorld);
    }
    const tip = curvePoints[curvePoints.length - 1] ?? tipWorld;
    const prev = curvePoints[Math.max(0, curvePoints.length - 5)] ?? tip;
    lastTip.current.copy(tip);

    if (phase === 'running') {
      // Rocket rides the tip, nose along the visual tangent.
      rocket.visible = true;
      rocket.position.copy(tip);
      const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
      rocket.rotation.z = angle - Math.PI / 2; // sprite is built nose-up
      // Exhaust hugs the curve behind the nozzle; sparks stream backwards.
      exhaust.current?.setRibbon(curvePoints, true);
      backDir.set(prev.x - tip.x, prev.y - tip.y, 0).normalize();
      exhaust.current?.emit(tip, backDir, 3);
      gridSpeed.current = 0.6 + logDisplay.current * 0.9;
    } else if (phase === 'busted') {
      rocket.visible = false;
      exhaust.current?.setRibbon(curvePoints, false);
      gridSpeed.current = MathUtils.damp(gridSpeed.current, 0.05, 4, dt);
      // Expanding shockwave ring at the bust point.
      const ring = ringRef.current;
      if (ring?.visible) {
        ring.position.copy(tip);
        ring.scale.addScalar(dt * 9);
        if (ring.scale.x > 6) ring.visible = false;
      }
    } else {
      // Waiting: rocket idles on the launch ramp, breathing gently.
      rocket.visible = true;
      const t = performance.now() / 1000;
      fracToWorld(0, 1.0001 / 2, tipWorld);
      rocket.position.set(PLOT.x0 + 0.55, PLOT.y0 + 0.45 + Math.sin(t * 1.6) * 0.05, 0);
      rocket.rotation.z = -0.18;
      exhaust.current?.setRibbon(curvePoints, false);
      gridSpeed.current = 0.4;
    }

    // Camera: look 70% toward the tip, FOV opens with the multiplier, and a
    // decaying shake right after the bust.
    lookTarget.lerp(
      phase === 'running' || phase === 'busted'
        ? tipWorld.copy(tip).multiplyScalar(0.7)
        : tipWorld.set(0, 0, 0),
      1 - Math.exp(-4 * dt),
    );
    shake.current = Math.max(0, shake.current - dt * 0.6);
    const jitter = shake.current * shake.current;
    camera.position.set(
      CAM_BASE.x + (Math.random() - 0.5) * jitter,
      CAM_BASE.y + (Math.random() - 0.5) * jitter,
      CAM_BASE.z,
    );
    camera.lookAt(lookTarget);
    const targetFov = 45 + Math.min(7, logDisplay.current * 2.2);
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = MathUtils.damp(camera.fov, targetFov, 6, dt);
      camera.updateProjectionMatrix();
    }
  });

  return (
    <>
      <Rocket3D ref={rocketRef} scale={1.05} />
      <ExhaustTrail handles={exhaust} />
      <GridFloor speedRef={gridSpeed} />
      {/* Shockwave ring — driven imperatively on bust. NOTE: no `visible` prop —
          the rig toggles mesh.visible and a declared prop would reapply on every
          20Hz re-render, silently overriding the imperative state. */}
      <mesh ref={ringRef}>
        <ringGeometry args={[0.42, 0.5, 48]} />
        <meshBasicMaterial color={emissive(NEON.amber, 2)} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      {/* Debris burst on bust — reuses the instanced confetti with fire colors */}
      <ConfettiBurst
        burstId={burstId}
        origin={burstOrigin}
        power={6}
        gravity={2.5}
        duration={1.4}
        size={0.14}
        colors={['#ffd36b', '#ff6a00', '#ff3d00', '#fff7e6']}
      />
    </>
  );
}

export default function CrashStage(props: CrashStageProps) {
  return (
    <StageCanvas
      frameloop="always"
      camera={{ position: [CAM_BASE.x, CAM_BASE.y, CAM_BASE.z], fov: 45 }}
      bloom={{ intensity: 1.05 }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 6]} intensity={1.2} />
      <pointLight position={[-5, 2, 3]} color={NEON.purple} intensity={4} />
      <Starfield radius={26} depth={14} size={0.08} opacity={0.7} drift={0.01} />
      <CrashRig {...props} />
    </StageCanvas>
  );
}
