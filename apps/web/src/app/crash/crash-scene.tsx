'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  MathUtils,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Mesh,
  type PerspectiveCamera,
  type Sprite,
} from 'three';
import { ConfettiBurst } from '@/components/three/confetti-burst';
import { StageCanvas } from '@/components/three/canvas-inner';
import { NEON, emissive } from '@/components/three/palette';
import { Starfield } from '@/components/three/starfield';
import { Rocket3D } from './crash-rocket-3d';
import { ExhaustTrail, type ExhaustHandles } from './exhaust-trail';
import { GridFloor } from './grid-floor';

export type CrashPhase = 'waiting' | 'running' | 'busted';

export interface CrashStageProps {
  multiplier: number;
  phase: CrashPhase;
  roundId: string | number | null;
}

// Side-view flight: the rocket holds a FIXED heading (up-right climb) while
// the world streams past it — ground scrolls, stars streak, altitude grows
// with the multiplier. Aviator-style staging, our neon look.
const HEADING = Math.atan2(0.62, 0.79); // ~38° climb
const DIR = new Vector3(Math.cos(HEADING), Math.sin(HEADING), 0);
const ROCKET_X = -1.3;
const BASE_Y = 0.1; // airborne even at 1.00x — never sitting on the floor
const CLIMB = 1.1; // how far up the frame it climbs as log(m) grows

const CAM_POS = new Vector3(0.4, 0.55, 7.2);
const lookTarget = new Vector3(ROCKET_X, BASE_Y, 0);
const rocketPos = new Vector3(ROCKET_X, BASE_Y, 0);
const nozzle = new Vector3();
const back = new Vector3();
const wobble = new Vector3();

const TRAIL_POINTS = 26;
const TRAIL_LEN = 4.2;

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
  const labelRef = useRef<Sprite>(null);
  const exhaust = useRef<ExhaustHandles | null>(null);
  const gridSpeed = useRef(0.3);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  // Log-space interpolation of the 20Hz ticks: extrapolate-then-correct so
  // corrections are imperceptible while the flight keeps moving at 60fps.
  const logTarget = useRef(0);
  const logDisplay = useRef(0);
  logTarget.current = Math.log(Math.max(1.0001, multiplier));

  const phaseRef = useRef(phase);
  const [burstId, setBurstId] = useState(0);
  const [burstOrigin, setBurstOrigin] = useState<[number, number, number]>([ROCKET_X, BASE_Y, 0]);
  const shake = useRef(0);
  const trail = useMemo(() => Array.from({ length: TRAIL_POINTS }, () => new Vector3()), []);

  // Hidden until the first bust (imperative — see the note on the mesh below).
  useLayoutEffect(() => {
    if (ringRef.current) ringRef.current.visible = false;
  }, []);

  // Bust: pin the display value, fire the explosion at the rocket, kick the camera.
  useEffect(() => {
    if (phase === 'busted' && phaseRef.current !== 'busted') {
      setBurstOrigin([rocketPos.x, rocketPos.y, rocketPos.z]);
      setBurstId((n) => n + 1);
      shake.current = 0.3;
      if (ringRef.current) {
        ringRef.current.visible = true;
        ringRef.current.scale.setScalar(0.2);
        ringRef.current.position.copy(rocketPos);
      }
    }
    if (phase === 'waiting') logDisplay.current = 0;
    phaseRef.current = phase;
  }, [phase, roundId]);

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
    // Altitude + speed grow with log(m): the climb is steady, the FEEL accelerates.
    const altitude = Math.min(CLIMB, logDisplay.current * 0.42);
    const speedFeel = 1 + logDisplay.current * 1.4;

    if (phase === 'running') {
      rocket.visible = true;
      rocketPos.set(
        ROCKET_X + altitude * 0.55, // drifts slightly forward as it climbs
        BASE_Y + altitude + Math.sin(t * 2.1) * 0.05,
        0,
      );
      rocket.position.copy(rocketPos);
      rocket.rotation.z = HEADING - Math.PI / 2 + Math.sin(t * 1.7) * 0.03; // nose on heading
      // Exhaust trail: straight wake along -heading with a live wobble + droop.
      nozzle.copy(rocketPos).addScaledVector(DIR, -0.45);
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const f = i / (TRAIL_POINTS - 1); // 1 = at nozzle, 0 = tail end
        const dist = (1 - f) * TRAIL_LEN;
        const p = trail[i];
        if (!p) continue;
        p.copy(nozzle).addScaledVector(DIR, -dist);
        // perpendicular wobble + gravity droop toward the tail
        wobble.set(-DIR.y, DIR.x, 0).multiplyScalar(Math.sin(t * 9 - dist * 2.2) * 0.05 * (1 - f));
        p.add(wobble);
        p.y -= (1 - f) * (1 - f) * 0.85;
      }
      exhaust.current?.setRibbon(trail, true);
      back.copy(DIR).multiplyScalar(-1);
      exhaust.current?.emit(nozzle, back, 3);
      gridSpeed.current = 0.5 + speedFeel * 0.8;
    } else if (phase === 'busted') {
      rocket.visible = false;
      exhaust.current?.setRibbon(trail, false);
      gridSpeed.current = MathUtils.damp(gridSpeed.current, 0.05, 4, dt);
      const ring = ringRef.current;
      if (ring?.visible) {
        ring.scale.addScalar(dt * 9);
        if (ring.scale.x > 6) ring.visible = false;
      }
    } else {
      // Waiting: hovering on idle thrust — airborne, never parked on the floor.
      rocket.visible = true;
      rocketPos.set(ROCKET_X, BASE_Y + Math.sin(t * 1.8) * 0.07, 0);
      rocket.position.copy(rocketPos);
      rocket.rotation.z = HEADING - Math.PI / 2;
      nozzle.copy(rocketPos).addScaledVector(DIR, -0.45);
      back.copy(DIR).multiplyScalar(-1);
      if (Math.random() < 0.5) exhaust.current?.emit(nozzle, back, 1); // idle puffs
      exhaust.current?.setRibbon(trail, false);
      gridSpeed.current = 0.3;
    }

    // Multiplier readout rides above the nose, always facing the camera.
    const label = labelRef.current;
    if (label) {
      label.visible = phase !== 'waiting';
      label.position.set(rocketPos.x + 1.15, rocketPos.y + 0.75, 0);
      const setText = label.userData.setText as ((text: string, color: string) => void) | undefined;
      if (phase === 'running') {
        setText?.(
          `${displayM.toFixed(2)}x`,
          displayM >= 10 ? NEON.purple : displayM >= 2 ? NEON.cyan : '#ffffff',
        );
      } else if (phase === 'busted') {
        label.position.set(burstOrigin[0] + 1.15, burstOrigin[1] + 0.75, 0);
        setText?.(`${Math.exp(logTarget.current).toFixed(2)}x`, NEON.danger);
      }
    }

    // Side camera: gentle parallax following the climb, FOV opens with speed,
    // decaying shake on bust.
    lookTarget.set(rocketPos.x + 0.6, MathUtils.damp(lookTarget.y, rocketPos.y * 0.8, 5, dt), 0);
    shake.current = Math.max(0, shake.current - dt * 0.6);
    const jitter = shake.current * shake.current;
    camera.position.set(
      CAM_POS.x + (Math.random() - 0.5) * jitter,
      CAM_POS.y + rocketPos.y * 0.25 + (Math.random() - 0.5) * jitter,
      CAM_POS.z,
    );
    camera.lookAt(lookTarget);
    const targetFov = 45 + Math.min(8, logDisplay.current * 2.4);
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = MathUtils.damp(camera.fov, targetFov, 6, dt);
      camera.updateProjectionMatrix();
    }
  });

  return (
    <>
      <Rocket3D ref={rocketRef} scale={1.5} />
      <MultiplierLabel labelRef={labelRef} />
      <ExhaustTrail handles={exhaust} />
      <GridFloor speedRef={gridSpeed} />
      {/* Shockwave ring — driven imperatively on bust. NOTE: no `visible` prop —
          the rig toggles mesh.visible and a declared prop would reapply on every
          20Hz re-render, silently overriding the imperative state. */}
      <mesh ref={ringRef}>
        <ringGeometry args={[0.42, 0.5, 48]} />
        <meshBasicMaterial color={emissive(NEON.amber, 2)} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      {/* Debris burst on bust — the instanced confetti with fire colors */}
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
