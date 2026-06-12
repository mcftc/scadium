'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { GameStage } from '@/components/three/game-stage';
import type { CrashPhase } from '@/app/crash/crash-scene';

const CrashStage = dynamic(() => import('@/app/crash/crash-scene'), {
  ssr: false,
  loading: () => null,
});

const GROWTH_RATE = 1.0024; // mirrors CRASH.GROWTH_RATE: m(t_ms) = G^(t_ms/10)
const WAIT_S = 4;
const BUST_HOLD_S = 3;

/**
 * Fake 20Hz tick driver replaying the real engine's lifecycle so the scene can
 * be previewed without the API: waiting countdown → exponential run to a
 * random bust point (1.2x–25x) → bust hold → next round.
 */
export function CrashPreview() {
  const [snap, setSnap] = useState<{ multiplier: number; phase: CrashPhase; roundId: number }>({
    multiplier: 1,
    phase: 'waiting',
    roundId: 1,
  });
  const [paused, setPaused] = useState(false);
  const bustAt = useRef(2.5);
  const phaseStart = useRef(0);

  useEffect(() => {
    if (paused) return;
    phaseStart.current = performance.now();
    const interval = setInterval(() => {
      const elapsed = (performance.now() - phaseStart.current) / 1000;
      setSnap((prev) => {
        if (prev.phase === 'waiting' && elapsed >= WAIT_S) {
          bustAt.current = 1.2 + Math.pow(Math.random(), 2.2) * 24;
          phaseStart.current = performance.now();
          return { multiplier: 1, phase: 'running', roundId: prev.roundId };
        }
        if (prev.phase === 'running') {
          const m = Math.pow(GROWTH_RATE, (elapsed * 1000) / 10);
          if (m >= bustAt.current) {
            phaseStart.current = performance.now();
            return { multiplier: bustAt.current, phase: 'busted', roundId: prev.roundId };
          }
          return { ...prev, multiplier: m };
        }
        if (prev.phase === 'busted' && elapsed >= BUST_HOLD_S) {
          phaseStart.current = performance.now();
          return { multiplier: 1, phase: 'waiting', roundId: prev.roundId + 1 };
        }
        return prev;
      });
    }, 50); // 20Hz, like the real gateway
    return () => clearInterval(interval);
  }, [paused]);

  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-[#080818]">
        <GameStage
          className="h-full w-full"
          fallback={
            <div className="flex h-full items-center justify-center text-foreground-muted">
              2D fallback (mevcut SVG sahne entegrasyonda korunur)
            </div>
          }
        >
          <CrashStage multiplier={snap.multiplier} phase={snap.phase} roundId={snap.roundId} />
        </GameStage>
        {/* The multiplier readout lives IN the scene (rides with the rocket);
            only the waiting countdown is DOM, like the real game page. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {snap.phase === 'waiting' && (
            <span className="text-2xl font-bold uppercase tracking-[0.4em] text-purple-300/80">
              Starting…
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm text-foreground-muted">
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="rounded-lg border border-border bg-surface-elevated px-4 py-2 font-semibold text-foreground"
        >
          {paused ? 'Resume driver' : 'Pause driver'}
        </button>
        <span>
          round #{snap.roundId} · {snap.phase} · bust @ {bustAt.current.toFixed(2)}x
        </span>
      </div>
    </div>
  );
}
