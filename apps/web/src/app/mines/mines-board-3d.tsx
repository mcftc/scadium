'use client';

import dynamic from 'next/dynamic';
import { GameStage } from '@/components/three/game-stage';
import type { MinesCellState } from '@/components/three/mines-scene';

const MinesStage = dynamic(() => import('@/components/three/mines-scene'), {
  ssr: false,
  loading: () => null,
});

/** 2D fallback grid (SSR / chunk load / no WebGL / reduced motion). */
function Fallback({
  cells,
  locked,
  onReveal,
}: {
  cells: MinesCellState[];
  locked: boolean;
  onReveal?: (i: number) => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="grid grid-cols-5 gap-1.5">
        {cells.map((c, i) => (
          <button
            key={i}
            type="button"
            data-testid="mines-tile"
            disabled={locked || c !== 'hidden'}
            onClick={() => onReveal?.(i)}
            className={
              'flex h-12 w-12 items-center justify-center rounded-md text-xl transition ' +
              (c === 'hidden'
                ? 'bg-surface-elevated hover:bg-surface enabled:hover:ring-1 enabled:hover:ring-primary-400'
                : c === 'gem'
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'bg-red-500/20 text-red-400')
            }
          >
            {c === 'gem' ? '◆' : c === 'bomb' ? '✸' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The Mines board theater: the approved flat, dead-on 3D scene with a 2D grid
 * fallback. Clicking a hidden tile calls `onReveal(index)`.
 */
export function MinesBoard3D({
  cells,
  bustCell,
  celebrate,
  locked,
  onReveal,
}: {
  cells: MinesCellState[];
  bustCell?: number | null;
  celebrate?: boolean;
  locked?: boolean;
  onReveal?: (index: number) => void;
}) {
  return (
    <div className="relative mx-auto aspect-video w-full">
      <GameStage
        className="h-full w-full"
        interactive
        fallback={<Fallback cells={cells} locked={!!locked} onReveal={onReveal} />}
      >
        <MinesStage
          cells={cells}
          bustCell={bustCell}
          celebrate={celebrate}
          locked={locked}
          onReveal={onReveal}
        />
      </GameStage>
    </div>
  );
}
