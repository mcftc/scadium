'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Crown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { formatSol, shortAddress } from '@/lib/format';
import type { JackpotPlayer } from '@/hooks/use-jackpot';
import { cn } from '@/lib/cn';

const PALETTE = [
  '#22d3ee',
  '#a855f7',
  '#f59e0b',
  '#34d399',
  '#f472b6',
  '#60a5fa',
  '#fb7185',
  '#4ade80',
];
const MIN_W = 150; // px — smallest stake still reads as a full card on the reel
const POT_W = 1500; // px — nominal width of one full-pot pass
const REPS = 8; // pot passes in the strip (long enough for a real spin)
const SPIN_MS = 5200;
const HOLD_MS = 3500; // winner banner dwell before dismiss

export interface JackpotReveal {
  players: JackpotPlayer[];
  winnerId: string;
  winnerName: string | null;
  payoutLamports: string;
  meId?: string;
}

/**
 * CSGO/solpump-style winner reveal: a horizontal reel of player segments
 * (width ∝ pot share) spins and decelerates so the winner lands under the
 * center pointer. The landing is on the winner's own segment — the actual
 * draw fairness is proven separately via the seed/verify panel.
 */
export function JackpotReel({ reveal, onDone }: { reveal: JackpotReveal; onDone: () => void }) {
  const { players, winnerId, payoutLamports, meId } = reveal;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  const [tx, setTx] = useState(0);
  const [phase, setPhase] = useState<'spin' | 'won'>('spin');

  const segs = useMemo(
    () =>
      players.map((p, i) => ({
        p,
        color: PALETTE[i % PALETTE.length]!,
        w: Math.max(MIN_W, Math.round(p.chance * POT_W)),
      })),
    [players],
  );
  const potW = useMemo(() => segs.reduce((s, x) => s + x.w, 0), [segs]);
  const winnerIdx = Math.max(
    0,
    players.findIndex((p) => p.userId === winnerId),
  );
  const winnerOffset = useMemo(() => {
    let o = 0;
    for (let i = 0; i < winnerIdx; i++) o += segs[i]!.w;
    return o + (segs[winnerIdx]?.w ?? 0) / 2;
  }, [segs, winnerIdx]);
  const winner = players[winnerIdx];
  const winnerName = reveal.winnerName ?? (winner ? shortAddress(winner.walletAddress) : 'anon');
  const iWon = !!meId && winner?.userId === meId;

  useLayoutEffect(() => {
    if (wrapRef.current) setCw(wrapRef.current.offsetWidth);
  }, []);

  useEffect(() => {
    if (cw === 0 || potW === 0) return;
    const landRep = REPS - 2; // leave a pass of segments trailing past the pointer
    const finalTx = cw / 2 - (landRep * potW + winnerOffset);
    // Two rAFs so the browser paints tx=0 first, then transitions to finalTx.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setTx(finalTx)));
    // Fallback in case onTransitionEnd is missed (e.g. interrupted paint).
    const fb = setTimeout(() => setPhase('won'), SPIN_MS + 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fb);
    };
  }, [cw, potW, winnerOffset]);

  useEffect(() => {
    if (phase !== 'won') return;
    const t = setTimeout(onDone, HOLD_MS);
    return () => clearTimeout(t);
  }, [phase, onDone]);

  const strip = useMemo(() => Array.from({ length: REPS }, () => segs).flat(), [segs]);

  return (
    <Card className="p-5 relative overflow-hidden">
      <div className="text-[10px] uppercase tracking-[0.4em] text-amber-400/80 mb-3 text-center">
        {phase === 'won' ? 'Winner' : 'Drawing winner…'}
      </div>
      <div
        ref={wrapRef}
        className="relative h-44 overflow-hidden rounded-2xl border border-border bg-background"
      >
        {/* center pointer */}
        <div className="absolute left-1/2 top-0 bottom-0 z-20 -translate-x-1/2 w-[3px] bg-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.95)]" />
        <div className="absolute left-1/2 -top-0.5 z-20 -translate-x-1/2 text-amber-400 text-lg leading-none drop-shadow-[0_0_6px_rgba(245,158,11,0.9)]">
          ▼
        </div>
        <div className="absolute left-1/2 -bottom-0.5 z-20 -translate-x-1/2 rotate-180 text-amber-400 text-lg leading-none drop-shadow-[0_0_6px_rgba(245,158,11,0.9)]">
          ▼
        </div>
        {/* edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-28 bg-gradient-to-r from-background via-background/80 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-28 bg-gradient-to-l from-background via-background/80 to-transparent" />
        {/* strip */}
        <div
          className="absolute top-0 bottom-0 flex will-change-transform"
          style={{
            transform: `translateX(${tx}px)`,
            transition: `transform ${SPIN_MS}ms cubic-bezier(0.12,0.7,0.16,1)`,
          }}
          onTransitionEnd={(e) => {
            if (e.propertyName === 'transform') setPhase('won');
          }}
        >
          {strip.map((s, i) => {
            const name = s.p.username ?? shortAddress(s.p.walletAddress);
            const isWinnerTile = phase === 'won' && s.p.userId === winnerId;
            return (
              <div
                key={i}
                className="flex h-full shrink-0 items-center p-2"
                style={{ width: s.w }}
              >
                {/* solpump-style player card */}
                <div
                  className={cn(
                    'relative flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border px-2 transition-all duration-300',
                    isWinnerTile
                      ? 'scale-105 border-amber-400 shadow-[0_0_28px_rgba(245,158,11,0.6)]'
                      : phase === 'won'
                        ? 'border-border/40 opacity-25'
                        : 'border-border/60',
                  )}
                  style={{
                    borderTopColor: s.color,
                    borderTopWidth: 3,
                    background: `linear-gradient(180deg, ${s.color}26 0%, rgba(10,10,16,0.4) 70%)`,
                  }}
                >
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-black shadow-lg ring-2 ring-white/10"
                    style={{ background: s.color, color: '#0b0b0f' }}
                  >
                    {name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="max-w-full truncate px-1 text-sm font-bold text-foreground">
                    {name}
                  </div>
                  <div className="font-mono text-xs text-foreground-muted">
                    {formatSol(s.p.amountLamports, 2)} SOL
                  </div>
                  <div
                    className="rounded-full px-2.5 py-0.5 text-xs font-black"
                    style={{ background: `${s.color}33`, color: s.color }}
                  >
                    {(s.p.chance * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {phase === 'won' && winner && (
        <div className="mt-4 flex items-center justify-center gap-2 text-base animate-in fade-in">
          <Crown className="h-5 w-5 text-amber-400" />
          <span className={cn('font-bold', iWon && 'text-success')}>
            {iWon ? 'You won' : `${winnerName} won`}
          </span>
          <span className="font-mono font-bold text-success">
            +{formatSol(payoutLamports, 3)}
          </span>
        </div>
      )}
    </Card>
  );
}
