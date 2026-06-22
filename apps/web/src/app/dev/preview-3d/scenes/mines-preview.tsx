'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { minesMultiplier, MINES } from '@scadium/shared';
import { GameStage } from '@/components/three/game-stage';
import type { MinesCellState } from '@/components/three/mines-scene';

const MinesStage = dynamic(() => import('@/components/three/mines-scene'), {
  ssr: false,
  loading: () => null,
});

const CELLS = MINES.CELLS; // 25

/** Random distinct bomb positions for a demo board. */
function layoutMines(count: number): Set<number> {
  const set = new Set<number>();
  while (set.size < count) set.add(Math.floor(Math.random() * CELLS));
  return set;
}

function emptyBoard(): MinesCellState[] {
  return Array.from({ length: CELLS }, () => 'hidden');
}

/** 2D fallback: a flat neon grid (stands in while the chunk loads / no WebGL). */
function Fallback({ cells }: { cells: MinesCellState[] }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="grid grid-cols-5 gap-1.5">
        {cells.map((c, i) => (
          <div
            key={i}
            className={
              'flex h-10 w-10 items-center justify-center rounded-md text-lg ' +
              (c === 'hidden'
                ? 'bg-surface-elevated'
                : c === 'gem'
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'bg-red-500/20 text-red-400')
            }
          >
            {c === 'gem' ? '◆' : c === 'bomb' ? '✸' : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MinesPreview() {
  const [mineCount, setMineCount] = useState(3);
  const [mines, setMines] = useState<Set<number>>(() => layoutMines(3));
  const [cells, setCells] = useState<MinesCellState[]>(emptyBoard);
  const [bustCell, setBustCell] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const gems = useMemo(() => cells.filter((c) => c === 'gem').length, [cells]);
  const ended = bustCell !== null || celebrate;
  const safeTotal = CELLS - mineCount;

  // Cash-out multiplier now, and what the next gem would pay — both scale with
  // the chosen mine count (more mines ⇒ steeper multipliers).
  const currentMult = gems > 0 ? minesMultiplier(mineCount, gems) : 0;
  const nextMult = !ended && gems < safeTotal ? minesMultiplier(mineCount, gems + 1) : null;

  const newRound = (count: number) => {
    setMineCount(count);
    setMines(layoutMines(count));
    setCells(emptyBoard());
    setBustCell(null);
    setCelebrate(false);
  };

  const reveal = (index: number) => {
    if (ended || cells[index] !== 'hidden') return;
    if (mines.has(index)) {
      // Bust: flip every bomb, mark the one that was hit.
      setCells((prev) => prev.map((c, i) => (mines.has(i) ? 'bomb' : c)));
      setBustCell(index);
      return;
    }
    const next = cells.map((c, i) => (i === index ? ('gem' as MinesCellState) : c));
    setCells(next);
    // Last safe tile → auto-win + confetti.
    if (next.filter((c) => c === 'gem').length >= safeTotal) {
      setCells((prev) => prev.map((c, i) => (mines.has(i) ? 'bomb' : c)));
      setCelebrate(true);
    }
  };

  return (
    <div className="space-y-5">
      <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-2xl border border-border bg-background">
        <GameStage className="h-full w-full" interactive fallback={<Fallback cells={cells} />}>
          <MinesStage
            cells={cells}
            bustCell={bustCell}
            celebrate={celebrate}
            locked={ended}
            onReveal={reveal}
          />
        </GameStage>

        {/* HUD overlay — current + next multiplier, status. */}
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-border bg-background/70 px-4 py-2 backdrop-blur">
          <div className="text-2xl font-bold text-cyan-300">{currentMult.toFixed(2)}×</div>
          <div className="text-xs text-foreground-muted">
            {ended
              ? bustCell !== null
                ? '💥 busted'
                : '✨ cleared'
              : nextMult !== null
                ? `next gem → ${nextMult.toFixed(2)}×`
                : ''}
          </div>
        </div>
      </div>

      {/* Mine-count selector — any value in [MIN_MINES, MAX_MINES]. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-3 text-sm text-foreground-muted">
          <span className="whitespace-nowrap">
            Mines: <span className="font-bold text-foreground">{mineCount}</span> / {CELLS}
          </span>
          <input
            type="range"
            min={MINES.MIN_MINES}
            max={MINES.MAX_MINES}
            value={mineCount}
            onChange={(e) => newRound(Number(e.target.value))}
            className="h-2 w-56 cursor-pointer accent-primary-500"
          />
        </label>
        <button
          type="button"
          onClick={() => newRound(mineCount)}
          className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm font-semibold text-foreground hover:text-primary-400"
        >
          New board
        </button>
        <span className="ml-auto text-sm text-foreground-muted">
          click a tile to reveal · gems {gems}/{safeTotal}
        </span>
      </div>
    </div>
  );
}
