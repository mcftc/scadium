'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, RoundedBox } from '@react-three/drei';
import { type Group, type MeshStandardMaterial } from 'three';
import { StageCanvas } from './canvas-inner';
import { ConfettiBurst } from './confetti-burst';
import { NEON, emissive } from './palette';

/** Per-tile state on the Tower board. */
export type TowerCellState = 'locked' | 'active' | 'safe' | 'trap';

export interface TowerStageProps {
  rows: number;
  columns: number;
  /** rows×columns flattened (index = row*columns + col); row 0 = bottom. */
  cells: TowerCellState[];
  celebrate?: boolean;
  /** Round ended — no clicks. */
  locked?: boolean;
  /** Click a tile in the active row. */
  onPick?: (row: number, col: number) => void;
}

const COL_SPACING = 1.35;
const ROW_SPACING = 0.92;

/** Flat XY layout facing the camera — row 0 at the bottom, no inward depth. */
function cellXY(row: number, col: number, rows: number, columns: number): [number, number] {
  const x = (col - (columns - 1) / 2) * COL_SPACING;
  const y = (row - (rows - 1) / 2) * ROW_SPACING;
  return [x, y];
}

function Tile({
  row,
  col,
  rows,
  columns,
  state,
  onPick,
}: {
  row: number;
  col: number;
  rows: number;
  columns: number;
  state: TowerCellState;
  onPick?: (row: number, col: number) => void;
}) {
  const panel = useRef<Group>(null);
  const token = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const [hover, setHover] = useState(false);
  const [x, y] = useMemo(() => cellXY(row, col, rows, columns), [row, col, rows, columns]);
  const clickable = state === 'active';
  const revealed = state === 'safe' || state === 'trap';

  useFrame((three) => {
    const t = three.clock.elapsedTime;
    const p = panel.current;
    if (p) {
      const targetZ = clickable && hover ? 0.34 : 0;
      p.position.z += (targetZ - p.position.z) * 0.2;
      // Active row pulses to invite a pick.
      const pulse = clickable ? 1 + Math.sin(t * 3 + col) * 0.02 : 1;
      const targetScale = (clickable && hover ? 1.06 : 1) * pulse;
      p.scale.x += (targetScale - p.scale.x) * 0.2;
      p.scale.y += (targetScale - p.scale.y) * 0.2;
    }
    const tok = token.current;
    if (tok) {
      tok.scale.setScalar(tok.scale.x + ((revealed ? 1 : 0) - tok.scale.x) * 0.22);
      if (state === 'safe') tok.rotation.y = t * 1.2;
      if (state === 'trap') {
        tok.rotation.y = t * 0.7;
        if (mat.current) mat.current.emissiveIntensity = 1.8 + Math.sin(t * 9) * 1;
      }
    }
  });

  const panelColor =
    state === 'trap'
      ? '#2a0e14'
      : state === 'safe'
        ? NEON.surfaceElevated
        : state === 'active'
          ? NEON.purpleDeep
          : NEON.surface;
  const panelEmissive =
    state === 'active' ? (hover ? 1.1 : 0.7) : state === 'trap' ? 0.5 : state === 'safe' ? 0.18 : 0.06;

  return (
    <group position={[x, y, 0]}>
      <group ref={panel}>
        <RoundedBox
          args={[1.18, 0.78, 0.2]}
          radius={0.1}
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
            onPick?.(row, col);
          }}
        >
          <meshStandardMaterial
            color={panelColor}
            emissive={emissive(state === 'trap' ? NEON.danger : state === 'safe' ? NEON.success : NEON.purple, 1)}
            emissiveIntensity={panelEmissive}
            metalness={0.6}
            roughness={0.34}
          />
        </RoundedBox>
      </group>

      <group ref={token} position={[0, 0, 0.4]} scale={0}>
        {state === 'safe' ? (
          <mesh>
            <octahedronGeometry args={[0.26, 0]} />
            <meshStandardMaterial
              color={NEON.success}
              emissive={emissive(NEON.success, 2.2)}
              emissiveIntensity={1.8}
              metalness={0.3}
              roughness={0.15}
            />
          </mesh>
        ) : null}
        {state === 'trap' ? (
          <mesh>
            <icosahedronGeometry args={[0.26, 0]} />
            <meshStandardMaterial
              ref={mat}
              color="#190a0e"
              emissive={emissive(NEON.danger, 2)}
              emissiveIntensity={1.8}
              metalness={0.5}
              roughness={0.4}
            />
          </mesh>
        ) : null}
      </group>
    </group>
  );
}

function TowerBoard({ rows, columns, cells, celebrate, locked, onPick }: TowerStageProps) {
  const invalidate = useThree((s) => s.invalidate);
  const [burst, setBurst] = useState(0);
  const was = useRef(false);

  useEffect(() => {
    if (celebrate && !was.current) setBurst((n) => n + 1);
    was.current = !!celebrate;
    invalidate();
  }, [celebrate, cells, invalidate]);

  return (
    <>
      {cells.map((state, i) => {
        const row = Math.floor(i / columns);
        const col = i % columns;
        return (
          <Tile
            key={i}
            row={row}
            col={col}
            rows={rows}
            columns={columns}
            state={locked && state === 'active' ? 'locked' : state}
            onPick={onPick}
          />
        );
      })}
      <ConfettiBurst burstId={burst} origin={[0, (rows - 1) / 2 * ROW_SPACING, 1.2]} power={3.6} gravity={3} duration={3.2} />
    </>
  );
}

export default function TowerStage(props: TowerStageProps) {
  return (
    // Telephoto, dead-on camera → flat tower, no inward perspective depth.
    <StageCanvas frameloop="always" camera={{ position: [0, 0, 15], fov: 32 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 6]} intensity={1} />
      <pointLight position={[-5, 0, 6]} color={NEON.cyan} intensity={2.4} />
      <pointLight position={[5, 0, 6]} color={NEON.purple} intensity={2.2} />
      <Environment resolution={64}>
        <Lightformer intensity={1.3} position={[0, 0, 6]} scale={[8, 10, 1]} color="#ffffff" />
        <Lightformer intensity={0.9} position={[-4, 2, 4]} scale={[3, 8, 1]} color={NEON.cyan} />
        <Lightformer intensity={1.1} position={[4, -2, 4]} scale={[3, 8, 1]} color={NEON.purple} />
      </Environment>
      <TowerBoard {...props} />
    </StageCanvas>
  );
}
