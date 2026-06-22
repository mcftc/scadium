'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, RoundedBox, Text } from '@react-three/drei';
import { type Group, type Mesh } from 'three';
import { StageCanvas } from './canvas-inner';
import { ConfettiBurst } from './confetti-burst';
import { NEON, emissive } from './palette';

export interface HiloStageProps {
  /** Current card index 0..51 (rank = card % 13, suit = card / 13). */
  card: number;
  /** Cumulative multiplier (for glow intensity only). */
  multiplier?: number;
  busted?: boolean;
  celebrate?: boolean;
  locked?: boolean;
  onGuess?: (direction: 'higher' | 'lower') => void;
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
function isRed(suit: number) {
  return suit === 1 || suit === 2;
}

/** A flat, camera-facing playing card with a plane-only (no-depth) flip. */
function Card({ card, busted }: { card: number; busted?: boolean }) {
  const group = useRef<Group>(null);
  const [shown, setShown] = useState(card);
  const incoming = useRef(card);
  const flipping = useRef(false);
  const swapped = useRef(true);

  useEffect(() => {
    if (card !== incoming.current) {
      incoming.current = card;
      flipping.current = true;
      swapped.current = false;
    }
  }, [card]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    if (flipping.current) {
      // Squash to a vertical line (scaleX→0), swap the face, expand back — a flat
      // flip with zero inward depth.
      if (!swapped.current) {
        g.scale.x -= 0.16;
        if (g.scale.x <= 0.02) {
          g.scale.x = 0.02;
          setShown(incoming.current);
          swapped.current = true;
        }
      } else {
        g.scale.x += 0.16;
        if (g.scale.x >= 1) {
          g.scale.x = 1;
          flipping.current = false;
        }
      }
    }
  });

  const rank = shown % 13;
  const suit = Math.floor(shown / 13);
  const color = isRed(suit) ? '#ff5d73' : '#f5f3ff';

  return (
    <group ref={group}>
      <RoundedBox args={[2.5, 3.5, 0.18]} radius={0.18} smoothness={4}>
        <meshStandardMaterial
          color={busted ? '#2a0e14' : '#171528'}
          emissive={emissive(busted ? NEON.danger : NEON.purple, 1)}
          emissiveIntensity={busted ? 0.5 : 0.35}
          metalness={0.5}
          roughness={0.35}
        />
      </RoundedBox>
      <Text position={[-0.78, 1.18, 0.1]} fontSize={0.55} color={color} anchorX="center" anchorY="middle">
        {RANKS[rank]}
      </Text>
      <Text position={[0, -0.1, 0.1]} fontSize={1.7} color={color} anchorX="center" anchorY="middle">
        {SUITS[suit]}
      </Text>
      <Text
        position={[0.78, -1.18, 0.1]}
        fontSize={0.55}
        color={color}
        anchorX="center"
        anchorY="middle"
        rotation={[0, 0, Math.PI]}
      >
        {RANKS[rank]}
      </Text>
    </group>
  );
}

/** A clickable chevron (higher = up/green, lower = down/amber). */
function GuessArrow({
  dir,
  disabled,
  onGuess,
}: {
  dir: 'higher' | 'lower';
  disabled: boolean;
  onGuess?: (d: 'higher' | 'lower') => void;
}) {
  const mesh = useRef<Mesh>(null);
  const [hover, setHover] = useState(false);
  const up = dir === 'higher';
  const color = up ? NEON.success : NEON.amber;

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const target = !disabled && hover ? 1.18 : 1;
    m.scale.x += (target - m.scale.x) * 0.2;
    m.scale.y += (target - m.scale.y) * 0.2;
    m.scale.z += (target - m.scale.z) * 0.2;
  });

  return (
    <mesh
      ref={mesh}
      position={[2.7, up ? 0.85 : -0.85, 0.2]}
      rotation={[0, 0, up ? 0 : Math.PI]}
      onPointerOver={(e) => {
        if (disabled) return;
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = 'auto';
      }}
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        onGuess?.(dir);
      }}
    >
      <coneGeometry args={[0.5, 0.8, 3]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive(color, 2)}
        emissiveIntensity={disabled ? 0.4 : hover ? 2.2 : 1.3}
        metalness={0.4}
        roughness={0.3}
      />
    </mesh>
  );
}

function HiloBoard({ card, busted, celebrate, locked, onGuess }: HiloStageProps) {
  const invalidate = useThree((s) => s.invalidate);
  const [burst, setBurst] = useState(0);
  const was = useRef(false);

  useEffect(() => {
    if (celebrate && !was.current) setBurst((n) => n + 1);
    was.current = !!celebrate;
    invalidate();
  }, [celebrate, card, invalidate]);

  const disabled = !!locked;

  return (
    <>
      <Card card={card} busted={busted} />
      <GuessArrow dir="higher" disabled={disabled} onGuess={onGuess} />
      <GuessArrow dir="lower" disabled={disabled} onGuess={onGuess} />
      <ConfettiBurst burstId={burst} origin={[0, 0, 1.4]} power={3.6} gravity={3} duration={3.2} />
    </>
  );
}

export default function HiloStage(props: HiloStageProps) {
  return (
    // Telephoto, dead-on camera → flat card, no inward perspective depth.
    <StageCanvas frameloop="always" camera={{ position: [0.8, 0, 11], fov: 36 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 6]} intensity={1} />
      <pointLight position={[-5, 2, 6]} color={NEON.cyan} intensity={2.4} />
      <pointLight position={[5, -2, 6]} color={NEON.purple} intensity={2.2} />
      <Environment resolution={64}>
        <Lightformer intensity={1.3} position={[0, 0, 6]} scale={[8, 8, 1]} color="#ffffff" />
        <Lightformer intensity={0.9} position={[-4, 2, 4]} scale={[3, 6, 1]} color={NEON.cyan} />
        <Lightformer intensity={1.1} position={[4, -2, 4]} scale={[3, 6, 1]} color={NEON.purple} />
      </Environment>
      <HiloBoard {...props} />
    </StageCanvas>
  );
}
