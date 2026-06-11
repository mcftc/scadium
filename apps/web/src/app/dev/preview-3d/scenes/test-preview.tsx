'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { GameStage } from '@/components/three/game-stage';

// The dynamic import is the bundle-split point: three.js and the scene live in
// async chunks and never enter this route's initial JS.
const TestStage = dynamic(() => import('./test-stage'), { ssr: false, loading: () => null });

export function TestPreview() {
  const [burstId, setBurstId] = useState(0);
  const [spinning, setSpinning] = useState(true);
  return (
    <div className="space-y-4">
      <GameStage
        fallback={<TestFallback />}
        className="aspect-video w-full overflow-hidden rounded-2xl border border-border bg-background"
      >
        <TestStage burstId={burstId} spinning={spinning} />
      </GameStage>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setBurstId((n) => n + 1)}
          className="rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow-sm"
        >
          Confetti
        </button>
        <button
          type="button"
          onClick={() => setSpinning((s) => !s)}
          className="rounded-lg border border-border bg-surface-elevated px-4 py-2 text-sm font-semibold text-foreground"
        >
          {spinning ? 'Pause spin' : 'Resume spin'}
        </button>
      </div>
      <p className="text-xs text-foreground-muted">
        2D fallback shows while the chunk loads, when WebGL is unavailable, or with reduced motion.
      </p>
    </div>
  );
}

function TestFallback() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <div className="h-24 w-24 animate-pulse rounded-full bg-gradient-primary shadow-glow" />
      <span className="text-xs uppercase tracking-widest text-foreground-muted">2D fallback</span>
    </div>
  );
}
