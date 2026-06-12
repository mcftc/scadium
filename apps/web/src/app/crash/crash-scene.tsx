'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  MathUtils,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type PerspectiveCamera,
  type Sprite,
} from 'three';
import { ConfettiBurst } from '@/components/three/confetti-burst';
import { StageCanvas } from '@/components/three/canvas-inner';
import { NEON, emissive } from '@/components/three/palette';
import { Starfield } from '@/components/three/starfield';
import { Rocket3D } from './crash-rocket-3d';
import { ExhaustTrail, type ExhaustHandles } from './exhaust-trail';
import { StageBackdrop } from './grid-floor';

export type CrashPhase = 'waiting' | 'running' | 'busted';

export interface CrashStageProps {
  multiplier: number;
  phase: CrashPhase;
  roundId: string | number | null;
}

// Film staging, true side profile: the rocket waits ON the launch pad, lifts
// off vertically at round start, pitches over onto a fixed up-right heading,
// and the camera tracks it laterally like a dolly shot — horizon in frame.
const HEADING = Math.atan2(0.62, 0.79); // ~38° climb once airborne
const DIR = new Vector3(Math.cos(HEADING), Math.sin(HEADING), 0);
const GROUND_Y = -2.1;
const PAD = new Vector3(-2.7, GROUND_Y + 0.78, 0); // rocket center, standing on the pad
const CRUISE = new Vector3(-1.2, 0.35, 0); // where the climb settles after pitch-over
const CLIMB = 1.15; // additional altitude as log(m) grows
const LAUNCH_S = 1.7; // liftoff + pitch-over duration

const CAM_POS = new Vector3(0.3, 0.4, 7.6);
const lookTarget = new Vector3(PAD.x, PAD.y, 0);
const rocketPos = new Vector3().copy(PAD);
const nozzle = new Vector3();
const back = new Vector3();
const down = new Vector3(0, -1, 0);

const TRAIL_POINTS = 26;

const FIRE_WHITE = new Color('#ffffff').multiplyScalar(3);
const FIRE_ORANGE = new Color('#ff6a00').multiplyScalar(2.2);
const FIRE_RED = new Color('#ef4444').multiplyScalar(2.6);
const fireTmp = new Color();

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInCubic(t: number): number {
  return t * t * t;
}

/** Live multiplier readout riding next to the rocket — canvas-texture sprite. */
function MultiplierLabel({ labelRef }: { labelRef: { current: Sprite | null } }) {
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 360;
    c.height = 144;
    return c;
  }, []);
  const texture = useMemo(() => {
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [canvas]);
  const lastText = useRef('');

  // The rig calls this through userData — avoids re-renders at 20Hz.
  useLayoutEffect(() => {
    const sprite = labelRef.current;
    if (!sprite) return;
    sprite.userData.setText = (text: string, color: string) => {
      if (text === lastText.current) return;
      lastText.current = text;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '900 96px "Geist Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = color;
      ctx.shadowBlur = 28;
      ctx.fillStyle = color;
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
      texture.needsUpdate = true;
    };
  }, [canvas, texture, labelRef]);

  return (
    <sprite ref={labelRef} scale={[1.75, 0.7, 1]} renderOrder={20}>
      <spriteMaterial map={texture} transparent depthWrite={false} depthTest={false} toneMapped={false} />
    </sprite>
  );
}

function CrashRig({ multiplier, phase, roundId }: CrashStageProps) {
  const rocketRef = useRef<Group>(null);
  const ringRef = useRef<Mesh>(null);
  const fireballRef = useRef<Mesh>(null);
  const labelRef = useRef<Sprite>(null);
  const exhaust = useRef<ExhaustHandles | null>(null);
  const gridSpeed = useRef(0.25);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  // Log-space interpolation of the 20Hz ticks.
  const logTarget = useRef(0);
  const logDisplay = useRef(0);
  logTarget.current = Math.log(Math.max(1.0001, multiplier));

  const phaseRef = useRef(phase);
  const runTime = useRef(0); // seconds since liftoff
  const bustTime = useRef(0); // seconds since the explosion
  const [burstId, setBurstId] = useState(0);
  const [burstOrigin, setBurstOrigin] = useState<[number, number, number]>([PAD.x, PAD.y, 0]);
  // The wake is the rocket's REAL recent path, drifting backwards with the world.
  const history = useMemo(
    () => Array.from({ length: TRAIL_POINTS }, () => new Vector3().copy(PAD)),
    [],
  );

  // Explosion props are imperative; hide them before the first frame.
  useLayoutEffect(() => {
    if (ringRef.current) ringRef.current.visible = false;
    if (fireballRef.current) fireballRef.current.visible = false;
  }, []);

  useEffect(() => {
    if (phase === 'running' && phaseRef.current !== 'running') {
      runTime.current = 0;
    }
    if (phase === 'busted' && phaseRef.current !== 'busted') {
      bustTime.current = 0;
      setBurstOrigin([rocketPos.x, rocketPos.y, rocketPos.z]);
      setBurstId((n) => n + 1);
      if (ringRef.current) {
        ringRef.current.visible = true;
        ringRef.current.scale.setScalar(0.2);
        ringRef.current.position.copy(rocketPos);
        (ringRef.current.material as MeshBasicMaterial).opacity = 0.9;
      }
      if (fireballRef.current) {
        fireballRef.current.visible = true;
        fireballRef.current.scale.setScalar(0.1);
        fireballRef.current.position.copy(rocketPos);
      }
    }
    if (phase === 'waiting') {
      logDisplay.current = 0;
      if (ringRef.current) ringRef.current.visible = false;
      if (fireballRef.current) fireballRef.current.visible = false;
      for (const p of history) p.copy(PAD);
    }
    phaseRef.current = phase;
  }, [phase, roundId, history]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const rocket = rocketRef.current;
    if (!rocket) return;
    const t = state.clock.elapsedTime;

    if (phase === 'running') {
      logDisplay.current = MathUtils.damp(logDisplay.current, logTarget.current, 12, dt);
    } else if (phase === 'busted') {
      logDisplay.current = logTarget.current;
    }
    const displayM = Math.exp(logDisplay.current);
    const altitude = Math.min(CLIMB, logDisplay.current * 0.42);
    const speedFeel = 1 + logDisplay.current * 1.4;

    if (phase === 'running') {
      runTime.current += dt;
      rocket.visible = true;
      const launch = MathUtils.clamp(runTime.current / LAUNCH_S, 0, 1);
      // Liftoff: straight up first (y eases out), drift downrange late (x eases
      // in), nose pitching from vertical onto the heading.
      rocketPos.set(
        MathUtils.lerp(PAD.x, CRUISE.x, easeInCubic(launch)) + altitude * 0.5,
        MathUtils.lerp(PAD.y, CRUISE.y, easeOutCubic(launch)) + altitude + Math.sin(t * 2.1) * 0.04 * launch,
        0,
      );
      rocket.position.copy(rocketPos);
      rocket.rotation.z = MathUtils.lerp(0, HEADING - Math.PI / 2, easeInCubic(launch));
      // Wake = real flight path, streaming backwards once cruising.
      nozzle.copy(rocketPos);
      nozzle.x -= Math.sin(rocket.rotation.z) * -0.6;
      nozzle.y -= Math.cos(rocket.rotation.z) * 0.6;
      for (const p of history) {
        p.addScaledVector(DIR, -speedFeel * launch * dt * 1.3);
      }
      for (let i = 0; i < TRAIL_POINTS - 1; i++) history[i]!.copy(history[i + 1]!);
      history[TRAIL_POINTS - 1]!.copy(nozzle);
      exhaust.current?.setRibbon(history, runTime.current > 0.1);
      // Ignition blast downward while lifting, then backwash along the wake.
      if (launch < 0.45) {
        exhaust.current?.emit(nozzle, down, 5);
      } else {
        back.set(-Math.cos(rocket.rotation.z + Math.PI / 2), -Math.sin(rocket.rotation.z + Math.PI / 2), 0);
        exhaust.current?.emit(nozzle, back.normalize(), 3);
      }
      gridSpeed.current = 0.4 + speedFeel * launch * 0.8;
    } else if (phase === 'busted') {
      bustTime.current += dt;
      const e = bustTime.current;
      rocket.visible = false;
      exhaust.current?.setRibbon(history, false);
      gridSpeed.current = MathUtils.damp(gridSpeed.current, 0.04, 4, dt);
      // Real detonation: white-hot fireball flash → orange swell → collapse
      // into a glowing red point that pulses until the next round.
      const fireball = fireballRef.current;
      if (fireball?.visible) {
        const material = fireball.material as MeshBasicMaterial;
        if (e < 0.16) {
          fireball.scale.setScalar(MathUtils.lerp(0.1, 1.9, easeOutCubic(e / 0.16)));
          material.color.copy(fireTmp.copy(FIRE_WHITE).lerp(FIRE_ORANGE, e / 0.16));
          material.opacity = 1;
        } else if (e < 0.55) {
          const s = (e - 0.16) / 0.39;
          fireball.scale.setScalar(MathUtils.lerp(1.9, 2.3, s));
          material.color.copy(fireTmp.copy(FIRE_ORANGE).lerp(FIRE_RED, s * 0.6));
          material.opacity = 1 - s * 0.25;
        } else {
          // Collapse to the red point.
          const s = Math.min(1, (e - 0.55) / 0.5);
          fireball.scale.setScalar(MathUtils.lerp(2.3, 0.12, easeInCubic(s)));
          material.color.copy(fireTmp.copy(FIRE_RED));
          material.opacity = 1;
          if (s >= 1) {
            // The lingering red ember, breathing.
            fireball.scale.setScalar(0.12 + Math.sin(t * 6) * 0.02);
          }
        }
      }
      const ring = ringRef.current;
      if (ring?.visible) {
        ring.scale.addScalar(dt * 14);
        const material = ring.material as MeshBasicMaterial;
        material.opacity = Math.max(0, material.opacity - dt * 1.6);
        if (material.opacity <= 0.01) ring.visible = false;
      }
    } else {
      // Waiting: standing on the pad, engines cold — wisps of idle vapor.
      rocket.visible = true;
      rocketPos.copy(PAD);
      rocket.position.copy(rocketPos);
      rocket.rotation.z = 0;
      exhaust.current?.setRibbon(history, false);
      if (Math.random() < 0.12) {
        nozzle.copy(PAD);
        nozzle.y -= 0.62;
        exhaust.current?.emit(nozzle, down, 1);
      }
      gridSpeed.current = 0.25;
    }

    // Multiplier readout — beside the action, always on top.
    const label = labelRef.current;
    if (label) {
      label.visible = phase !== 'waiting';
      const anchorX = phase === 'busted' ? burstOrigin[0] : rocketPos.x;
      const anchorY = phase === 'busted' ? burstOrigin[1] : rocketPos.y;
      label.position.set(anchorX + 1.3, anchorY + 0.85, 0);
      const setText = label.userData.setText as ((text: string, color: string) => void) | undefined;
      if (phase === 'running') {
        setText?.(
          `${displayM.toFixed(2)}x`,
          displayM >= 10 ? NEON.purple : displayM >= 2 ? NEON.cyan : '#ffffff',
        );
      } else if (phase === 'busted') {
        setText?.(`${Math.exp(logTarget.current).toFixed(2)}x`, NEON.danger);
      }
    }

    // EXACT side shot — pure lateral dolly, zero tilt, zero yaw, fixed FOV.
    // The camera tracks the action's height and slides with it; depth comes
    // only from the backdrop parallax, never from camera-angle tricks.
    const focusY = phase === 'busted' ? burstOrigin[1] : rocketPos.y;
    const focusX = phase === 'busted' ? burstOrigin[0] : rocketPos.x;
    camera.position.set(
      MathUtils.damp(camera.position.x, focusX + 0.7, 5, dt),
      MathUtils.damp(camera.position.y, focusY + 0.25, 5, dt),
      CAM_POS.z,
    );
    lookTarget.set(camera.position.x, camera.position.y, 0);
    camera.lookAt(lookTarget);
  });

  return (
    <>
      <Rocket3D ref={rocketRef} scale={1.5} />
      <MultiplierLabel labelRef={labelRef} />
      <ExhaustTrail handles={exhaust} />
      <StageBackdrop speedRef={gridSpeed} groundY={GROUND_Y} />
      {/* Launch pad on the ground */}
      <group position={[PAD.x, GROUND_Y, 0]}>
        <mesh position={[0, 0.08, 0]}>
          <cylinderGeometry args={[0.65, 0.78, 0.16, 32]} />
          <meshStandardMaterial color={NEON.surfaceElevated} metalness={0.6} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.56, 0.015, 8, 48]} />
          <meshStandardMaterial
            color={NEON.purpleDeep}
            emissive={emissive(NEON.purple, 1)}
            emissiveIntensity={2}
          />
        </mesh>
      </group>
      {/* Detonation fireball → collapses into the lingering red ember */}
      <mesh ref={fireballRef}>
        <sphereGeometry args={[0.5, 24, 16]} />
        <meshBasicMaterial transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {/* Shockwave ring — imperative (no `visible` prop: re-renders would reapply it) */}
      <mesh ref={ringRef}>
        <ringGeometry args={[0.46, 0.5, 48]} />
        <meshBasicMaterial color={emissive(NEON.amber, 2)} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      {/* Debris burst — instanced confetti with fire colors */}
      <ConfettiBurst
        burstId={burstId}
        origin={burstOrigin}
        power={7}
        gravity={3}
        duration={1.2}
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
      camera={{ position: [CAM_POS.x, CAM_POS.y, CAM_POS.z], fov: 45 }}
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
