'use client';

import { useState } from 'react';
import { FlipCoin } from '@/app/coinflip/flip-coin';
import { FlipCoin3D } from '@/app/coinflip/flip-coin-3d';
import type { CoinSide } from '@/app/coinflip/flip-coin';

export function CoinflipPreview() {
  const [result, setResult] = useState<CoinSide>('heads');
  const [spinning, setSpinning] = useState(false);
  const [celebrate, setCelebrate] = useState(true);
  const [slowmo, setSlowmo] = useState(false);
  const [lastLanded, setLastLanded] = useState<CoinSide | null>(null);

  const flip = (side: CoinSide) => {
    if (spinning) return;
    setLastLanded(null);
    setResult(side);
    setSpinning(true);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-border bg-background p-6">
        <FlipCoin3D
          result={result}
          spinning={spinning}
          size={160}
          celebrate={celebrate}
          speed={slowmo ? 0.25 : 1}
          onSpinComplete={() => {
            setSpinning(false);
            setLastLanded(result);
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-foreground-muted">
            3D {lastLanded ? `— landed ${lastLanded}` : spinning ? '— tossing…' : ''}
          </span>
          <div className="flex items-center gap-3">
            <FlipCoin result={result} spinning={spinning} size={72} />
            <span className="text-[10px] uppercase tracking-widest text-foreground-muted">
              2D (mevcut)
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => flip('heads')}
          disabled={spinning}
          className="rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow-sm disabled:opacity-50"
        >
          Flip → Heads
        </button>
        <button
          type="button"
          onClick={() => flip('tails')}
          disabled={spinning}
          className="rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow-sm disabled:opacity-50"
        >
          Flip → Tails
        </button>
        <button
          type="button"
          onClick={() => flip(Math.random() < 0.5 ? 'heads' : 'tails')}
          disabled={spinning}
          className="rounded-lg border border-border bg-surface-elevated px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
        >
          Flip random
        </button>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            checked={celebrate}
            onChange={(e) => setCelebrate(e.target.checked)}
          />
          Confetti on land
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input type="checkbox" checked={slowmo} onChange={(e) => setSlowmo(e.target.checked)} />
          Slow motion (×0.25)
        </label>
      </div>
    </div>
  );
}
