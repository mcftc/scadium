'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Vector3, type Group, type Mesh, type MeshBasicMaterial } from 'three';
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

const TOSS_S = 3.2; // a beat longer than the DOM coin: the camera ride needs room
const SETTLE_S = 0.6;
const REVS = 6;
const TOSS_HEIGHT = 1.5;

// Camera choreography: wide tableau (robot + crowd) → dolly in with the toss →
// close-up as the spin dies, so the face is only readable at the very end.
const CAM_WIDE = new Vector3(0, 0.9, 7.6);
const CAM_CLOSE = new Vector3(0, 0.4, 2.9);
const camTmp = new Vector3();

/** Fast off the robot's flick, long dramatic deceleration into the reveal. */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type Phase = 'idle' | 'toss' | 'settle';

const SPECTATORS: ReadonlyArray<readonly [number, number, number, number]> = [
  [2.4, -0.85, -1.2, -0.5],
  [1.5, -0.9, -2.4, -0.25],
  [-1.6, -0.88, -2.6, 0.35],
  [3.1, -0.8, 0.1, -0.9],
  [-2.9, -0.86, -1.8, 0.7],
];

function CoinRig({ result, spinning, celebrate = false, speed = 1, onSpinComplete }: CoinStageProps) {
  const spd = Math.max(speed, 0.05); // speed=0 would freeze the toss and never fire onSpinComplete
  const tossGroup = useRef<Group>(null);
  const spinGroup = useRef<Group>(null);
  const shadowMesh = useRef<Mesh>(null);
  const armGroup = useRef<Group>(null);
  const spectatorHeads = useRef<(Group | null)[]>([]);
  const phase = useRef<Phase>('idle');
  const elapsed = useRef(0);
  const wasSpinning = useRef(false);
  const targetSpin = useRef(0);
  const [burstId, setBurstId] = useState(0);
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);

  const headsFace = getCoinFaceTexture('heads');
  const tailsFace = getCoinFaceTexture('tails');

  const restAngle = (side: CoinSide) => Math.PI / 2 + (side === 'tails' ? Math.PI : 0);

  useEffect(() => {
    if (spinning && !wasSpinning.current) {
      phase.current = 'toss';
      elapsed.current = 0;
      targetSpin.current = REVS * Math.PI * 2 + (result === 'tails' ? Math.PI : 0);
      invalidate();
    }
    wasSpinning.current = spinning;
    if (!spinning && phase.current === 'idle' && spinGroup.current) {
      spinGroup.current.rotation.x = restAngle(result);
      invalidate();
    }
  }, [spinning, result, invalidate]);

  useFrame((_, delta) => {
    const toss = tossGroup.current;
    const spin = spinGroup.current;
    const shadow = shadowMesh.current;
    if (!toss || !spin) return;
    if (phase.current === 'idle') return;

    // Demand frameloop: clamp the post-idle delta spike or the toss ends in one frame.
    elapsed.current += Math.min(delta, 1 / 30) * spd;

    if (phase.current === 'toss') {
      const t = Math.min(elapsed.current / TOSS_S, 1);
      const y = TOSS_HEIGHT * 4 * t * (1 - t);
      toss.position.y = y;
      spin.rotation.x = Math.PI / 2 + targetSpin.current * easeOutQuint(t);
      toss.rotation.z = Math.sin(t * 14) * 0.1 * (1 - t);
      if (shadow) {
        const lift = y / TOSS_HEIGHT;
        shadow.scale.setScalar(2.1 * (1 - 0.4 * lift));
        (shadow.material as MeshBasicMaterial).opacity = 0.5 - 0.3 * lift;
      }
      // The robot's flick — a snap at the very start of the toss.
      if (armGroup.current) {
        const flick = Math.min((t * TOSS_S) / 0.45, 1);
        armGroup.current.rotation.z = -0.5 - 1.7 * Math.sin(flick * Math.PI);
      }
      // The crowd looks up, following the coin.
      for (const head of spectatorHeads.current) {
        if (head) head.rotation.x = -y * 0.3;
      }
      // Dolly: wide tableau → in on the coin as the spin decays.
      camTmp.lerpVectors(CAM_WIDE, CAM_CLOSE, easeInOutCubic(t));
      camera.position.copy(camTmp);
      camera.position.y += y * 0.12;
      camera.lookAt(0, y * 0.6, 0);
      if (t >= 1) {
        phase.current = 'settle';
        elapsed.current = 0;
        if (celebrate) setBurstId((n) => n + 1);
      }
    } else if (phase.current === 'settle') {
      const s = Math.min(elapsed.current / SETTLE_S, 1);
      spin.rotation.x = restAngle(result) + 0.08 * Math.exp(-6 * s) * Math.sin(24 * s);
      toss.position.y = 0;
      toss.rotation.z = 0;
      if (armGroup.current) armGroup.current.rotation.z = -0.5;
      for (const head of spectatorHeads.current) {
        if (head) head.rotation.x = 0;
      }
      const dip = 0.05 * Math.exp(-10 * s);
      camera.position.copy(CAM_CLOSE);
      camera.position.y -= dip;
      camera.lookAt(0, 0, 0);
      if (shadow) {
        shadow.scale.setScalar(2.1);
        (shadow.material as MeshBasicMaterial).opacity = 0.5;
      }
      if (s >= 1) {
        phase.current = 'idle';
        spin.rotation.x = restAngle(result);
        onSpinComplete?.();
      }
    }
    invalidate();
  });

  return (
    <>
      {/* The $SCAD coin */}
      <group ref={tossGroup}>
        <group ref={spinGroup} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[1, 1, 0.14, 72]} />
            <meshStandardMaterial
              attach="material-0"
              map={getCoinEdgeTexture()}
              metalness={0.7}
              roughness={0.35}
            />
            <meshStandardMaterial attach="material-1" color="#3a3360" metalness={0.6} roughness={0.4} />
            <meshStandardMaterial attach="material-2" color="#3a3360" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.0712, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.985, 72]} />
            <meshStandardMaterial
              map={headsFace}
              emissiveMap={headsFace}
              emissive="#ffffff"
              emissiveIntensity={0.38}
              metalness={0.4}
              roughness={0.32}
            />
          </mesh>
          <mesh position={[0, -0.0712, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.985, 72]} />
            <meshStandardMaterial
              map={tailsFace}
              emissiveMap={tailsFace}
              emissive="#ffffff"
              emissiveIntensity={0.38}
              metalness={0.4}
              roughness={0.32}
            />
          </mesh>
          {/* Neon rim feeding the bloom pass */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.005, 0.022, 12, 96]} />
            <meshStandardMaterial
              color={NEON.purpleDeep}
              emissive={emissive(NEON.purple, 1)}
              emissiveIntensity={1.7}
              metalness={0.6}
              roughness={0.3}
            />
          </mesh>
        </group>
      </group>

      {/* The android who throws the coin */}
      <group position={[-2.5, -0.7, -0.7]} rotation={[0, 0.5, 0]}>
        <mesh position={[0, 0.45, 0]}>
          <capsuleGeometry args={[0.3, 0.62, 8, 16]} />
          <meshStandardMaterial color="#2A2640" metalness={0.85} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.12, 0]}>
          <sphereGeometry args={[0.24, 24, 16]} />
          <meshStandardMaterial color="#332e52" metalness={0.85} roughness={0.25} />
        </mesh>
        {/* Glowing eyes, antenna and chest core — these bloom */}
        <mesh position={[-0.085, 1.16, 0.2]}>
          <sphereGeometry args={[0.04, 12, 8]} />
          <meshStandardMaterial emissive={emissive(NEON.cyan, 1)} emissiveIntensity={2.6} color="#0a3a44" />
        </mesh>
        <mesh position={[0.085, 1.16, 0.2]}>
          <sphereGeometry args={[0.04, 12, 8]} />
          <meshStandardMaterial emissive={emissive(NEON.cyan, 1)} emissiveIntensity={2.6} color="#0a3a44" />
        </mesh>
        <mesh position={[0, 1.42, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.14, 6]} />
          <meshStandardMaterial color="#332e52" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.52, 0]}>
          <sphereGeometry args={[0.03, 10, 8]} />
          <meshStandardMaterial emissive={emissive(NEON.purple, 1)} emissiveIntensity={2.4} color="#3a1a40" />
        </mesh>
        <mesh position={[0, 0.62, 0.27]}>
          <circleGeometry args={[0.07, 16]} />
          <meshStandardMaterial emissive={emissive(NEON.purple, 1)} emissiveIntensity={2} color="#3a1a40" />
        </mesh>
        {/* Throwing arm — flicks at toss start */}
        <group ref={armGroup} position={[0.3, 0.78, 0]} rotation={[0, 0, -0.5]}>
          <mesh position={[0.26, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.07, 0.42, 6, 12]} />
            <meshStandardMaterial color="#2A2640" metalness={0.85} roughness={0.3} />
          </mesh>
          <mesh position={[0.52, 0, 0]}>
            <sphereGeometry args={[0.09, 12, 8]} />
            <meshStandardMaterial color="#332e52" metalness={0.85} roughness={0.25} />
          </mesh>
        </group>
      </group>

      {/* The crowd, waiting on the result */}
      {SPECTATORS.map(([x, y, z, ry], i) => (
        <group key={i} position={[x, y, z]} rotation={[0, ry, 0]}>
          <mesh position={[0, 0.4, 0]}>
            <capsuleGeometry args={[0.26, 0.55, 6, 12]} />
            <meshStandardMaterial
              color={NEON.surfaceElevated}
              emissive={emissive(NEON.purpleDeep, 1)}
              emissiveIntensity={0.12}
              roughness={0.8}
            />
          </mesh>
          <group
            ref={(node) => {
              spectatorHeads.current[i] = node;
            }}
            position={[0, 0.98, 0]}
          >
            <mesh>
              <sphereGeometry args={[0.19, 20, 14]} />
              <meshStandardMaterial
                color={NEON.surfaceElevated}
                emissive={emissive(NEON.purpleDeep, 1)}
                emissiveIntensity={0.15}
                roughness={0.8}
              />
            </mesh>
          </group>
        </group>
      ))}

      {/* Pedestal + glow ring under the coin */}
      <mesh position={[0, -1.52, 0]}>
        <cylinderGeometry args={[1.3, 1.45, 0.16, 48]} />
        <meshStandardMaterial color={NEON.surface} metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh position={[0, -1.43, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.18, 0.018, 8, 64]} />
        <meshStandardMaterial
          color={NEON.purpleDeep}
          emissive={emissive(NEON.purple, 1)}
          emissiveIntensity={2.2}
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>
      <BlobShadow meshRef={shadowMesh} position={[0, -1.42, 0]} scale={2.1} opacity={0.5} />
      <ConfettiBurst burstId={burstId} origin={[0, 0.2, 0.9]} power={3.2} gravity={3.2} duration={3.2} />
    </>
  );
}

export default function CoinStage(props: CoinStageProps) {
  return (
    <StageCanvas
      frameloop="demand"
      camera={{ position: [CAM_WIDE.x, CAM_WIDE.y, CAM_WIDE.z], fov: 38 }}
    >
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      <pointLight position={[-4, 1, -2]} color={NEON.cyan} intensity={5} />
      <pointLight position={[0, -0.5, 2.5]} color={NEON.purple} intensity={3} />
      <Starfield radius={24} depth={12} size={0.07} opacity={0.55} />
      {/* Procedural environment — metal reflections without any network fetch. */}
      <Environment resolution={64}>
        <Lightformer intensity={1.8} position={[0, 3, 4]} scale={[6, 3, 1]} color="#ffffff" />
        <Lightformer intensity={1} position={[-4, 0, 2]} scale={[3, 6, 1]} color={NEON.cyan} />
        <Lightformer intensity={1.3} position={[4, -1, 3]} scale={[3, 6, 1]} color={NEON.purple} />
      </Environment>
      <CoinRig {...props} />
    </StageCanvas>
  );
}
