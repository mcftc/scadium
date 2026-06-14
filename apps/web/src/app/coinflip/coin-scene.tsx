'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Grid, Lightformer } from '@react-three/drei';
import { Vector3, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import { AndroidMascot, type MascotRig } from '@/components/three/android-mascot';
import { BlobShadow } from '@/components/three/blob-shadow';
import { StageCanvas } from '@/components/three/canvas-inner';
import { ConfettiBurst } from '@/components/three/confetti-burst';
import { NEON, emissive } from '@/components/three/palette';
import { Starfield } from '@/components/three/starfield';
import type { CoinSide } from './flip-coin';
import { getCoinEdgeTexture, getCoinFaceTexture } from './coin-textures';

export interface CoinStageProps {
  result: CoinSide;
  spinning: boolean;
  /** Fire a confetti celebration when the toss lands. */
  celebrate?: boolean;
  /** Animation speed multiplier — preview slow-motion only; clamped > 0. */
  speed?: number;
  onSpinComplete?: () => void;
}

const TOSS_S = 3.0;
const SETTLE_S = 0.7;
const REVS = 7;
const COIN_HOME = 0.2; // resting hover height above the pedestal
const ARC = 1.95; // toss apex above home

// Camera choreography: wide tableau (tosser + crowd) holds through the spin, then
// a late dolly-in so the face only resolves at the very end of the toss.
const CAM_WIDE = new Vector3(0.1, 0.95, 7.9);
const CAM_CLOSE = new Vector3(0, 0.45, 3.25);
const DOLLY_START = 0.72;
const camTmp = new Vector3();
const lookTmp = new Vector3();

function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
/** 0→1→0 hump for a single quick gesture inside a [a,b] window. */
function pulse(t: number, a: number, b: number): number {
  if (t <= a || t >= b) return 0;
  return Math.sin(((t - a) / (b - a)) * Math.PI);
}
/** Eased ramp from value `from` to `to` across the window [a,b], clamped outside. */
function ramp(t: number, a: number, b: number, from: number, to: number): number {
  if (t <= a) return from;
  if (t >= b) return to;
  return from + (to - from) * easeInOutCubic((t - a) / (b - a));
}

type Phase = 'idle' | 'toss' | 'settle';

// Throwing-arm joint angles (rotation.z): rest → wind-up → release.
const ARM_REST = 0.55;
const ARM_WIND = -0.35;
const ARM_THROW = 2.55;
const FORE_REST = 0.7;
const FORE_THROW = 0.05;

function CoinRig({ result, spinning, celebrate = false, speed = 1, onSpinComplete }: CoinStageProps) {
  const spd = Math.max(speed, 0.05);
  const tossGroup = useRef<Group>(null);
  const spinGroup = useRef<Group>(null);
  const shadowMesh = useRef<Mesh>(null);
  const rig = useRef<MascotRig>({});
  const torso = useRef<Group>(null);
  const head = useRef<Group>(null);
  const rUpper = useRef<Group>(null);
  const rFore = useRef<Group>(null);
  const phase = useRef<Phase>('idle');
  const elapsed = useRef(0);
  const wasSpinning = useRef(false);
  const targetSpin = useRef(0);
  const [burstId, setBurstId] = useState(0);
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);

  const headsFace = getCoinFaceTexture('heads');
  const tailsFace = getCoinFaceTexture('tails');
  const edge = getCoinEdgeTexture();

  rig.current = { torso, head, rUpperArm: rUpper, rForeArm: rFore };

  const restAngle = (side: CoinSide) => Math.PI / 2 + (side === 'tails' ? Math.PI : 0);

  const setArm = (upper: number, fore: number, lean: number, headTilt: number) => {
    if (rUpper.current) rUpper.current.rotation.z = upper;
    if (rFore.current) rFore.current.rotation.z = fore;
    if (torso.current) torso.current.rotation.z = lean;
    if (head.current) head.current.rotation.x = headTilt;
  };

  useEffect(() => {
    if (spinning && !wasSpinning.current) {
      phase.current = 'toss';
      elapsed.current = 0;
      targetSpin.current = REVS * Math.PI * 2 + (result === 'tails' ? Math.PI : 0);
      invalidate();
    }
    wasSpinning.current = spinning;
    if (!spinning && phase.current === 'idle') {
      if (spinGroup.current) spinGroup.current.rotation.x = restAngle(result);
      if (tossGroup.current) tossGroup.current.position.y = COIN_HOME;
      setArm(ARM_REST, FORE_REST, 0, 0);
      invalidate();
    }
  }, [spinning, result, invalidate]);

  useFrame((_, delta) => {
    const toss = tossGroup.current;
    const spin = spinGroup.current;
    const shadow = shadowMesh.current;
    if (!toss || !spin) return;
    if (phase.current === 'idle') return;

    elapsed.current += Math.min(delta, 1 / 30) * spd;

    if (phase.current === 'toss') {
      const t = Math.min(elapsed.current / TOSS_S, 1);

      // Coin: parabolic arc up from home, fast-then-slow tumble (face hides until late).
      const y = COIN_HOME + ARC * 4 * t * (1 - t);
      toss.position.y = y;
      toss.rotation.z = Math.sin(t * 13) * 0.09 * (1 - t);
      spin.rotation.x = Math.PI / 2 + targetSpin.current * easeOutQuint(t);

      // Robot throw: wind-up → snap → follow-through back to rest.
      const wind = pulse(t, 0.0, 0.16); // pull back before the throw
      const upper = ramp(t, 0.12, 0.26, ARM_WIND, ARM_THROW) - wind * 0.5 + ramp(t, 0.32, 1, 0, ARM_REST - ARM_THROW);
      const fore = ramp(t, 0.12, 0.24, FORE_REST, FORE_THROW) + ramp(t, 0.3, 1, 0, FORE_REST - FORE_THROW);
      const lean = pulse(t, 0.1, 0.4) * -0.22 + ramp(t, 0.0, 0.12, 0, 0.1);
      setArm(upper, fore, lean, -Math.min(y, 2) * 0.18);

      if (shadow) {
        const lift = (y - COIN_HOME) / ARC;
        shadow.scale.setScalar(2.0 * (1 - 0.45 * lift));
        (shadow.material as MeshBasicMaterial).opacity = 0.5 - 0.32 * lift;
      }
      // Hold wide, then dolly in for the reveal.
      const d = t < DOLLY_START ? 0 : easeInOutCubic((t - DOLLY_START) / (1 - DOLLY_START));
      camTmp.lerpVectors(CAM_WIDE, CAM_CLOSE, d);
      camera.position.copy(camTmp);
      camera.position.y += (1 - d) * y * 0.1;
      lookTmp.set(0, y * (1 - d) * 0.55 + d * COIN_HOME, 0);
      camera.lookAt(lookTmp);

      if (t >= 1) {
        phase.current = 'settle';
        elapsed.current = 0;
        if (celebrate) setBurstId((n) => n + 1);
      }
    } else if (phase.current === 'settle') {
      const s = Math.min(elapsed.current / SETTLE_S, 1);
      spin.rotation.x = restAngle(result) + 0.09 * Math.exp(-6 * s) * Math.sin(22 * s);
      toss.position.y = COIN_HOME - 0.04 * Math.exp(-9 * s) * Math.sin(20 * s);
      toss.rotation.z = 0;
      setArm(ARM_REST, FORE_REST, 0, 0);
      camera.position.copy(CAM_CLOSE);
      camera.position.y -= 0.05 * Math.exp(-10 * s);
      camera.lookAt(0, COIN_HOME, 0);
      if (shadow) {
        shadow.scale.setScalar(2.0);
        (shadow.material as MeshBasicMaterial).opacity = 0.5;
      }
      if (s >= 1) {
        phase.current = 'idle';
        spin.rotation.x = restAngle(result);
        toss.position.y = COIN_HOME;
        onSpinComplete?.();
      }
    }
    invalidate();
  });

  return (
    <>
      {/* The $SCAD coin — milled metal disc with embossed relief faces. */}
      <group ref={tossGroup} position={[0, COIN_HOME, 0]}>
        <group ref={spinGroup} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[1, 1, 0.18, 96]} />
            <meshStandardMaterial attach="material-0" map={edge} metalness={0.92} roughness={0.28} envMapIntensity={1.4} />
            <meshStandardMaterial attach="material-1" color="#2a2548" metalness={0.7} roughness={0.4} />
            <meshStandardMaterial attach="material-2" color="#2a2548" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Heads face (robot bust) — solid satin metal, no self-glow. */}
          <mesh position={[0, 0.0925, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.985, 96]} />
            <meshStandardMaterial
              map={headsFace}
              bumpMap={headsFace}
              bumpScale={0.03}
              metalness={0.9}
              roughness={0.42}
              envMapIntensity={0.85}
            />
          </mesh>
          {/* Tails face (1 SCAD). */}
          <mesh position={[0, -0.0925, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.985, 96]} />
            <meshStandardMaterial
              map={tailsFace}
              bumpMap={tailsFace}
              bumpScale={0.03}
              metalness={0.9}
              roughness={0.42}
              envMapIntensity={0.85}
            />
          </mesh>
          {/* Chamfer rings — bevel the silhouette so it reads as struck metal. */}
          {[0.082, -0.082].map((y) => (
            <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.97, 0.03, 10, 96]} />
              <meshStandardMaterial color="#3a3360" metalness={0.92} roughness={0.4} envMapIntensity={0.9} />
            </mesh>
          ))}
          {/* Subtle neon edge — kept low so the spinning coin doesn't flare. */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.01, 0.018, 12, 110]} />
            <meshStandardMaterial
              color={NEON.purpleDeep}
              emissive={emissive(NEON.purple, 1)}
              emissiveIntensity={0.7}
              metalness={0.7}
              roughness={0.35}
            />
          </mesh>
        </group>
      </group>

      {/* The android tosser. */}
      <group position={[-1.35, -1.45, -0.1]} rotation={[0, 0.42, 0]}>
        <AndroidMascot rig={rig.current} accent={NEON.cyan} />
      </group>

      {/* Pedestal + glow ring under the coin. */}
      <mesh position={[0, -1.52, 0]}>
        <cylinderGeometry args={[1.25, 1.42, 0.16, 56]} />
        <meshStandardMaterial color={NEON.surface} metalness={0.5} roughness={0.55} />
      </mesh>
      <mesh position={[0, -1.43, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.14, 0.018, 8, 72]} />
        <meshStandardMaterial color={NEON.purpleDeep} emissive={emissive(NEON.purple, 1)} emissiveIntensity={1.8} metalness={0.5} roughness={0.4} />
      </mesh>

      {/* Synthwave grid floor receding into the space backdrop. */}
      <Grid
        position={[0, -1.6, -1]}
        args={[40, 40]}
        cellSize={0.7}
        cellThickness={1}
        cellColor={NEON.purpleDeep}
        sectionSize={3.5}
        sectionThickness={1.5}
        sectionColor={NEON.cyan}
        fadeDistance={26}
        fadeStrength={3}
        followCamera={false}
        infiniteGrid
      />
      <BlobShadow meshRef={shadowMesh} position={[0, -1.42, 0]} scale={2.0} opacity={0.5} />
      <ConfettiBurst burstId={burstId} origin={[0, COIN_HOME, 0.5]} power={3.4} gravity={3.0} duration={3.2} />
    </>
  );
}

export default function CoinStage(props: CoinStageProps) {
  return (
    <StageCanvas frameloop="demand" camera={{ position: [CAM_WIDE.x, CAM_WIDE.y, CAM_WIDE.z], fov: 38 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 4]} intensity={0.9} />
      <spotLight position={[0, 5, 2.5]} angle={0.5} penumbra={0.9} intensity={1.2} color="#ffffff" />
      <pointLight position={[-4, 1, -2]} color={NEON.cyan} intensity={3.2} />
      <pointLight position={[3, -0.5, 2.5]} color={NEON.purple} intensity={2.2} />
      <Starfield radius={24} depth={12} size={0.07} opacity={0.55} />
      <Environment resolution={64}>
        <Lightformer intensity={1.3} position={[0, 3, 4]} scale={[6, 3, 1]} color="#ffffff" />
        <Lightformer intensity={0.9} position={[-4, 0, 2]} scale={[3, 6, 1]} color={NEON.cyan} />
        <Lightformer intensity={1.1} position={[4, -1, 3]} scale={[3, 6, 1]} color={NEON.purple} />
      </Environment>
      <CoinRig {...props} />
    </StageCanvas>
  );
}
