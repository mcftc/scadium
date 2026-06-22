'use client';

import dynamic from 'next/dynamic';
import { GameStage } from '@/components/three/game-stage';
import type { TowerCellState } from '@/components/three/tower-scene';

const TowerStage = dynamic(() => import('@/components/three/tower-scene'), {
  ssr: false,
  loading: () => null,
});

/** 2D fallback (SSR / chunk load / no WebGL / reduced motion). Row 0 at the bottom. */
function Fallback({
  rows,
  columns,
  cells,
  onPick,
}: {
  rows: number;
  columns: number;
  cells: TowerCellState[];
  onPick?: (row: number, col: number) => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="flex flex-col-reverse gap-1.5">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-1.5">
            {Array.from({ length: columns }, (_, c) => {
              const s = cells[r * columns + c];
              return (
                <button
                  key={c}
                  type="button"
                  data-testid="tower-tile"
                  disabled={s !== 'active'}
                  onClick={() => onPick?.(r, c)}
                  className={
                    'flex h-8 w-20 items-center justify-center rounded text-sm transition ' +
                    (s === 'active'
                      ? 'bg-primary-500/30 text-primary-200 hover:bg-primary-500/50'
                      : s === 'safe'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : s === 'trap'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-surface-elevated/60')
                  }
                >
                  {s === 'safe' ? '◆' : s === 'trap' ? '✸' : ''}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The Tower board theater: approved flat 3D scene + a clickable 2D fallback. */
export function TowerBoard3D({
  rows,
  columns,
  cells,
  celebrate,
  locked,
  onPick,
}: {
  rows: number;
  columns: number;
  cells: TowerCellState[];
  celebrate?: boolean;
  locked?: boolean;
  onPick?: (row: number, col: number) => void;
}) {
  return (
    <div className="relative mx-auto aspect-[3/4] w-full sm:aspect-video">
      <GameStage
        className="h-full w-full"
        interactive
        fallback={<Fallback rows={rows} columns={columns} cells={cells} onPick={onPick} />}
      >
        <TowerStage
          rows={rows}
          columns={columns}
          cells={cells}
          celebrate={celebrate}
          locked={locked}
          onPick={onPick}
        />
      </GameStage>
    </div>
  );
}
