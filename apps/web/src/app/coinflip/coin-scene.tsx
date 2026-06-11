'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import type { Group, Mesh, MeshBasicMaterial } from 'three';
import { BlobShadow } from '@/components/three/blob-shadow';
import { StageCanvas } from '@/components/three/canvas-inner';
import { ConfettiBurst } from '@/components/three/confetti-burst';
import { NEON, emissive } from '@/components/three/palette';
import type { CoinSide } from './flip-coin';
import { getCoinEdgeTexture, getCoinFaceTexture } from './coin-textures';

export interface CoinStageProps {
  result: CoinSide;
  spinning: boolean;
  /** Fire a confetti celebration when the toss lands. */
  celebrate?: boolean;
  /** Animation speed multiplier — preview uses <1 for slow-motion capture. */
  speed?: number;
  onSpinComplete?: () => void;
}

const TOSS_S = 2.4; // matches the DOM FlipCoin timing budget
const SETTLE_S = 0.5;
const REVS = 5; // full end-over-end revolutions, like the DOM version
const TOSS_HEIGHT = 1.15; // world units (coin radius = 1)

/** Strong ease-out: fast spin off the thumb, slow deceleration into the landing. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

type Phase = 'idle' | 'toss' | 'settle';

function CoinRig({
  result,
  spinning,
  celebrate = false,
  speed = 1,
  onSpinComplete,
}: CoinStageProps) {
  const tossGroup = useRef<Group>(null);
  const spinGroup = useRef<Group>(null);
  const shadowMesh = useRef<Mesh>(null);
  const phase = useRef<Phase>('idle');
  const elapsed = useRef(0);
  const wasSpinning = useRef(false);
  const targetSpin = useRef(0);
  const [burstId, setBurstId] = useState(0);
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);

  // Static pose for the idle coin (also the landing pose after a toss).
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

    // Demand frameloop: the first frame after idle arrives with a delta spanning
    // the whole idle gap — clamp it or the toss finishes in one frame.
    elapsed.current += Math.min(delta, 1 / 30) * speed;

    if (phase.current === 'toss') {
      const t = Math.min(elapsed.current / TOSS_S, 1);
      const y = TOSS_HEIGHT * 4 * t * (1 - t);
      toss.position.y = y;
      spin.rotation.x = Math.PI / 2 + targetSpin.current * easeOutCubic(t);
      // Precession wobble that dies out toward the catch.
      toss.rotation.z = Math.sin(t * 14) * 0.12 * (1 - t);
      // Shadow breathes with height.
      if (shadow) {
        const lift = y / TOSS_HEIGHT;
        shadow.scale.setScalar(2.1 * (1 - 0.4 * lift));
        (shadow.material as MeshBasicMaterial).opacity = 0.5 - 0.3 * lift;
      }
      // Camera tracks a fraction of the toss arc.
      camera.position.y = 0.7 + y * 0.18;
      camera.lookAt(0, y * 0.5, 0);
      if (t >= 1) {
        phase.current = 'settle';
        elapsed.current = 0;
        if (celebrate) setBurstId((n) => n + 1);
      }
    } else if (phase.current === 'settle') {
      const s = Math.min(elapsed.current / SETTLE_S, 1);
      // Damped wobble around the rest pose + a one-frame camera dip on impact.
      spin.rotation.x =
        restAngle(result) + 0.1 * Math.exp(-6 * s) * Math.sin(24 * s);
      toss.position.y = 0;
      toss.rotation.z = 0;
      const shake = 0.05 * Math.exp(-10 * s);
      camera.position.y = 0.7 - shake;
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
      <group ref={tossGroup}>
        <group ref={spinGroup} rotation={[Math.PI / 2, 0, 0]}>
          {/* Coin body — plain metal caps (hidden under the face discs) + milled edge. */}
          <mesh>
            <cylinderGeometry args={[1, 1, 0.14, 72]} />
            <meshStandardMaterial
              attach="material-0"
              map={getCoinEdgeTexture(result)}
              metalness={0.7}
              roughness={0.35}
            />
            <meshStandardMaterial attach="material-1" color="#3a3360" metalness={0.6} roughness={0.4} />
            <meshStandardMaterial attach="material-2" color="#3a3360" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Face discs — explicit orientation control so H/T always read upright. */}
          <mesh position={[0, 0.0712, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.985, 72]} />
            <meshStandardMaterial
              map={getCoinFaceTexture('heads')}
              emissiveMap={getCoinFaceTexture('heads')}
              emissive="#ffffff"
              emissiveIntensity={0.38}
              metalness={0.4}
              roughness={0.32}
            />
          </mesh>
          <mesh position={[0, -0.0712, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.985, 72]} />
            <meshStandardMaterial
              map={getCoinFaceTexture('tails')}
              emissiveMap={getCoinFaceTexture('tails')}
              emissive="#ffffff"
              emissiveIntensity={0.38}
              metalness={0.4}
              roughness={0.32}
            />
          </mesh>
          {/* Neon rim that feeds the bloom pass. */}
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
      <BlobShadow meshRef={shadowMesh} position={[0, -1.35, 0]} scale={2.1} opacity={0.5} />
      <ConfettiBurst burstId={burstId} origin={[0, 0.2, 0.8]} power={3.2} gravity={3.2} duration={3.2} />
    </>
  );
}

export default function CoinStage(props: CoinStageProps) {
  return (
    <StageCanvas frameloop="demand" camera={{ position: [0, 0.7, 4.3], fov: 40 }}>
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      <pointLight position={[-4, 1, -2]} color={NEON.cyan} intensity={5} />
      {/* Procedural environment — gives the metal its reflections, no network fetch. */}
      <Environment resolution={64}>
        <Lightformer intensity={1.8} position={[0, 3, 4]} scale={[6, 3, 1]} color="#ffffff" />
        <Lightformer intensity={1} position={[-4, 0, 2]} scale={[3, 6, 1]} color={NEON.cyan} />
        <Lightformer intensity={1.3} position={[4, -1, 3]} scale={[3, 6, 1]} color={NEON.purple} />
      </Environment>
      <CoinRig {...props} />
    </StageCanvas>
  );
}
