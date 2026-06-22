'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, RoundedBox } from '@react-three/drei';
import { type Group, type MeshStandardMaterial } from 'three';
import { StageCanvas } from './canvas-inner';
import { ConfettiBurst } from './confetti-burst';
import { NEON, emissive } from './palette';

/** Per-cell visual state on the Mines board. */
export type MinesCellState = 'hidden' | 'gem' | 'bomb';

export interface MinesStageProps {
  /** GRID×GRID states (length 25). */
  cells: MinesCellState[];
  /** The bomb tile that ended the round (extra-emphasised), if any. */
  bustCell?: number | null;
  /** Fire confetti (a clean cash-out / full clear). */
  celebrate?: boolean;
  /** Clicking a hidden tile (ignored once the round has ended). */
  onReveal?: (index: number) => void;
  /** Round ended — clicks ignored, hidden tiles stop reacting. */
  locked?: boolean;
}

const GRID = 5;
const SPACING = 1.18;
const CENTER = (GRID - 1) / 2;

/** Flat XY layout facing the camera — row 0 on top, no inward depth. */
function cellXY(i: number): [number, number] {
  const row = Math.floor(i / GRID);
  const col = i % GRID;
  return [(col - CENTER) * SPACING, (CENTER - row) * SPACING];
}

/** A single front-facing board tile + the token it reveals (gem / bomb). */
function Tile({
  index,
  state,
  bust,
  locked,
  onReveal,
}: {
  index: number;
  state: MinesCellState;
  bust: boolean;
  locked: boolean;
  onReveal?: (index: number) => void;
}) {
  const panel = useRef<Group>(null);
  const token = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const [hover, setHover] = useState(false);
  const [x, y] = useMemo(() => cellXY(index), [index]);
  const revealed = state !== 'hidden';
  const clickable = !revealed && !locked;

  useFrame((three) => {
    const t = three.clock.elapsedTime;
    const p = panel.current;
    if (p) {
      // Flat board: tiles stay in-plane. Hidden tiles gently breathe; a hovered
      // clickable tile lifts slightly TOWARD the camera (no inward depth).
      const targetZ = revealed ? -0.12 : clickable && hover ? 0.32 : 0;
      p.position.z += (targetZ - p.position.z) * 0.2;
      const breathe = revealed ? 1 : 1 + Math.sin(t * 1.8 + index * 0.4) * 0.015;
      const targetScale = (clickable && hover ? 1.06 : 1) * breathe;
      p.scale.x += (targetScale - p.scale.x) * 0.2;
      p.scale.y += (targetScale - p.scale.y) * 0.2;
    }
    const tok = token.current;
    if (tok) {
      const targetScale = revealed ? 1 : 0;
      tok.scale.setScalar(tok.scale.x + (targetScale - tok.scale.x) * 0.2);
      if (state === 'gem') tok.rotation.y = t * 1.2;
      if (state === 'bomb') {
        tok.rotation.y = t * 0.7;
        if (mat.current) mat.current.emissiveIntensity = bust ? 2.4 + Math.sin(t * 9) * 1.2 : 1.5;
      }
    }
  });

  return (
    <group position={[x, y, 0]}>
      {/* The tile panel (front-facing flat cover). */}
      <group ref={panel}>
        <RoundedBox
          args={[1.04, 1.04, 0.22]}
          radius={0.12}
          smoothness={3}
          onPointerOver={(e) => {
            if (!clickable) return;
            e.stopPropagation();
            setHover(true);
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            setHover(false);
            document.body.style.cursor = 'auto';
          }}
          onClick={(e) => {
            if (!clickable) return;
            e.stopPropagation();
            onReveal?.(index);
          }}
        >
          <meshStandardMaterial
            color={
              state === 'bomb'
                ? '#2a0e14'
                : state === 'gem'
                  ? NEON.surfaceElevated
                  : NEON.purpleDeep
            }
            emissive={emissive(state === 'bomb' ? NEON.danger : NEON.purple, 1)}
            emissiveIntensity={revealed ? (state === 'bomb' ? 0.5 : 0.18) : hover ? 0.9 : 0.5}
            metalness={0.6}
            roughness={0.34}
          />
        </RoundedBox>
      </group>

      {/* Revealed token, popped toward the camera (+z), never inward. */}
      <group ref={token} position={[0, 0, 0.45]} scale={0}>
        {state === 'gem' ? (
          <mesh>
            <octahedronGeometry args={[0.32, 0]} />
            <meshStandardMaterial
              ref={mat}
              color={NEON.cyan}
              emissive={emissive(NEON.cyan, 2.2)}
              emissiveIntensity={1.8}
              metalness={0.3}
              roughness={0.15}
            />
          </mesh>
        ) : null}
        {state === 'bomb' ? (
          <group>
            <mesh>
              <icosahedronGeometry args={[0.3, 0]} />
              <meshStandardMaterial
                ref={mat}
                color="#190a0e"
                emissive={emissive(NEON.danger, 2)}
                emissiveIntensity={1.5}
                metalness={0.5}
                roughness={0.4}
              />
            </mesh>
            <mesh position={[0, 0.36, 0]}>
              <sphereGeometry args={[0.055, 8, 8]} />
              <meshStandardMaterial color={NEON.amber} emissive={emissive(NEON.amber, 3)} emissiveIntensity={2.5} />
            </mesh>
          </group>
        ) : null}
      </group>
    </group>
  );
}

function MinesBoard({ cells, bustCell, celebrate, onReveal, locked }: MinesStageProps) {
  const invalidate = useThree((s) => s.invalidate);
  const [burst, setBurst] = useState(0);
  const wasCelebrating = useRef(false);

  useEffect(() => {
    if (celebrate && !wasCelebrating.current) setBurst((n) => n + 1);
    wasCelebrating.current = !!celebrate;
    invalidate();
  }, [celebrate, cells, invalidate]);

  return (
    <>
      {cells.map((state, i) => (
        <Tile
          key={i}
          index={i}
          state={state}
          bust={bustCell === i}
          locked={!!locked}
          onReveal={onReveal}
        />
      ))}

      {/* Neon frame around the flat board. */}
      <mesh position={[0, 0, -0.18]}>
        <planeGeometry args={[GRID * SPACING + 0.5, GRID * SPACING + 0.5]} />
        <meshStandardMaterial color={NEON.surface} metalness={0.3} roughness={0.7} transparent opacity={0.6} />
      </mesh>
      <ConfettiBurst burstId={burst} origin={[0, 0, 1.2]} power={3.6} gravity={3} duration={3.2} />
    </>
  );
}

export default function MinesStage(props: MinesStageProps) {
  return (
    // Telephoto, dead-on camera → flat board, no inward perspective depth.
    <StageCanvas frameloop="always" camera={{ position: [0, 0, 17], fov: 26 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 6]} intensity={1} />
      <pointLight position={[-5, 3, 6]} color={NEON.cyan} intensity={2.6} />
      <pointLight position={[5, -3, 6]} color={NEON.purple} intensity={2.2} />
      <Environment resolution={64}>
        <Lightformer intensity={1.3} position={[0, 0, 6]} scale={[8, 8, 1]} color="#ffffff" />
        <Lightformer intensity={0.9} position={[-4, 2, 4]} scale={[3, 6, 1]} color={NEON.cyan} />
        <Lightformer intensity={1.1} position={[4, -2, 4]} scale={[3, 6, 1]} color={NEON.purple} />
      </Environment>
      <MinesBoard {...props} />
    </StageCanvas>
  );
}
