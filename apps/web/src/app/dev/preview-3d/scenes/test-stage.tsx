'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { BlobShadow } from '@/components/three/blob-shadow';
import { StageCanvas } from '@/components/three/canvas-inner';
import { ConfettiBurst } from '@/components/three/confetti-burst';
import { NEON, emissive } from '@/components/three/palette';
import { Starfield } from '@/components/three/starfield';

function SpinningKnot({ spinning }: { spinning: boolean }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (!spinning || !group.current) return;
    group.current.rotation.y += delta * 0.9;
    group.current.rotation.x += delta * 0.35;
  });
  return (
    <group ref={group} position={[0, 0.4, 0]}>
      <mesh>
        <torusKnotGeometry args={[1, 0.32, 160, 24]} />
        <meshStandardMaterial
          color={NEON.purpleDeep}
          metalness={0.85}
          roughness={0.25}
          emissive={emissive(NEON.purple, 1)}
          emissiveIntensity={0.32}
        />
      </mesh>
    </group>
  );
}

export default function TestStage({ burstId, spinning }: { burstId: number; spinning: boolean }) {
  return (
    <StageCanvas frameloop="always" camera={{ position: [0, 1.2, 6], fov: 45 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 5]} intensity={1.1} />
      <pointLight position={[-5, 2, -3]} color={NEON.cyan} intensity={6} />
      <Starfield />
      <SpinningKnot spinning={spinning} />
      <BlobShadow position={[0, -1.6, 0]} scale={3.2} opacity={0.45} />
      <ConfettiBurst burstId={burstId} origin={[0, 0.2, 1]} duration={6} gravity={1.2} power={2} />
    </StageCanvas>
  );
}
