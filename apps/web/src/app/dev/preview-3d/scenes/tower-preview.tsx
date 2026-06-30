'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { towerMultiplier, TOWER } from '@scadium/shared';
import { GameStage } from '@/components/three/game-stage';
import type { TowerCellState } from '@/components/three/tower-scene';

const TowerStage = dynamic(() => import('@/components/three/tower-scene'), {
  ssr: false,
  loading: () => null,
});

const ROWS = TOWER.ROWS;
const COLS = TOWER.COLUMNS;
const TRAPS_PER_ROW = COLS - TOWER.SAFE_PER_ROW;

/** One random trap column-set per row. */
function layoutTraps(): Set<number>[] {
  return Array.from({ length: ROWS }, () => {
    const s = new Set<number>();
    while (s.size < TRAPS_PER_ROW) s.add(Math.floor(Math.random() * COLS));
    return s;
  });
}

/** 2D fallback: a flat column of rows. */
function Fallback({ cells }: { cells: TowerCellState[] }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="flex flex-col-reverse gap-1.5">
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="flex gap-1.5">
            {Array.from({ length: COLS }, (_, c) => {
              const s = cells[r * COLS + c];
              return (
                <div
                  key={c}
                  className={
                    'flex h-7 w-16 items-center justify-center rounded text-sm ' +
                    (s === 'active'
                      ? 'bg-primary-500/30 text-primary-200'
                      : s === 'safe'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : s === 'trap'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-surface-elevated/60')
                  }
                >
                  {s === 'safe' ? '◆' : s === 'trap' ? '✸' : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TowerPreview() {
  const [traps, setTraps] = useState<Set<number>[]>(layoutTraps);
  const [currentRow, setCurrentRow] = useState(0);
  const [picks, setPicks] = useState<number[]>([]);
  const [bust, setBust] = useState<{ row: number; col: number } | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const ended = bust !== null || celebrate;

  const cells = useMemo<TowerCellState[]>(() => {
    const out: TowerCellState[] = [];
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        let state: TowerCellState = 'locked';
        if (ended) {
          if (r < picks.length && picks[r] === c) state = 'safe';
          else if (traps[r]!.has(c)) state = 'trap';
          else state = 'locked';
        } else if (r < currentRow) {
          state = picks[r] === c ? 'safe' : 'locked';
        } else if (r === currentRow) {
          state = 'active';
        }
        out.push(state);
      }
    }
    return out;
    // `bust`/`celebrate` are intentionally excluded — they only feed `ended`
    // (already a dep), and the cell states read `ended`, not those values.
  }, [traps, currentRow, picks, ended]);

  const currentMult = currentRow > 0 ? towerMultiplier(currentRow) : 0;
  const nextMult = !ended && currentRow < ROWS ? towerMultiplier(currentRow + 1) : null;

  const newTower = () => {
    setTraps(layoutTraps());
    setCurrentRow(0);
    setPicks([]);
    setBust(null);
    setCelebrate(false);
  };

  const pick = (row: number, col: number) => {
    if (ended || row !== currentRow) return;
    if (traps[row]!.has(col)) {
      setBust({ row, col });
      return;
    }
    const nextPicks = [...picks, col];
    setPicks(nextPicks);
    if (currentRow + 1 >= ROWS) {
      setCurrentRow(ROWS);
      setCelebrate(true);
    } else {
      setCurrentRow(currentRow + 1);
    }
  };

  return (
    <div className="space-y-5">
      <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-2xl border border-border bg-background">
        <GameStage className="h-full w-full" interactive fallback={<Fallback cells={cells} />}>
          <TowerStage
            rows={ROWS}
            columns={COLS}
            cells={cells}
            celebrate={celebrate}
            locked={ended}
            onPick={pick}
          />
        </GameStage>

        <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-border bg-background/70 px-4 py-2 backdrop-blur">
          <div className="text-2xl font-bold text-emerald-300">{currentMult.toFixed(2)}×</div>
          <div className="text-xs text-foreground-muted">
            {ended
              ? bust !== null
                ? '💥 busted'
                : '✨ reached the top'
              : nextMult !== null
                ? `next row → ${nextMult.toFixed(2)}×`
                : ''}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={newTower}
          className="rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow-sm"
        >
          New tower
        </button>
        <span className="text-sm text-foreground-muted">
          {COLS} tiles/row · {TRAPS_PER_ROW} trap · climb {currentRow}/{ROWS} — click a tile in the
          lit row
        </span>
      </div>
    </div>
  );
}
