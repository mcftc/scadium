'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { PLINKO } from '@scadium/shared';
import { Card } from '@/components/ui/card';
import {
  BetAmountInput,
  isValidBetSol,
  solToLamportsClamped,
} from '@/components/instant/bet-amount-input';
import { InstantFairness } from '@/components/instant/instant-fairness';
import { WinEffect } from '@/components/instant/win-effect';
import { useGameSound } from '@/components/instant/use-game-sound';
import { useInstantGame, type InstantSettleResult } from '@/hooks/use-instant-game';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';

type Rows = (typeof PLINKO.ROWS)[number];

/** Tier color for a bin multiplier — hot (>2×) → neutral (~1×) → cold (<1×). */
function binColor(m: number): string {
  if (m >= 5) return 'bg-[#EE86FF] text-black';
  if (m >= 2) return 'bg-primary-400/80 text-white';
  if (m >= 1) return 'bg-surface-elevated text-foreground';
  return 'bg-surface text-foreground-muted';
}

export function PlinkoGame() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const play = useInstantGame<{ amountLamports: string; rows: number }>('plinko');
  const sound = useGameSound();

  const [sol, setSol] = useState('0.1');
  const [rows, setRows] = useState<Rows>(12);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<InstantSettleResult | null>(null);

  const payouts = PLINKO.PAYOUTS[rows] ?? [];
  const validBet = isValidBetSol(sol, PLINKO.MIN_BET_LAMPORTS);

  async function onPlace() {
    if (!isAuthenticated) {
      openWallet();
      return;
    }
    setError(null);
    try {
      const res = await play.mutateAsync({
        amountLamports: solToLamportsClamped(sol, PLINKO.MIN_BET_LAMPORTS, PLINKO.MAX_BET_LAMPORTS),
        rows,
      });
      setLast(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bet failed');
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-3">
        <PlinkoBoard
          rows={rows}
          result={last}
          payouts={payouts}
          binColor={binColor}
          sound={sound}
        />
        <WinEffect last={last} sound={sound} />
      </div>

      <div className="w-full lg:w-[300px] shrink-0 lg:pr-8 space-y-4">
        <Card className="p-5 space-y-4">
          <BetAmountInput
            sol={sol}
            setSol={setSol}
            minLamports={PLINKO.MIN_BET_LAMPORTS}
            maxLamports={PLINKO.MAX_BET_LAMPORTS}
            disabled={play.isPending}
          />

          <div>
            <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">Rows</div>
            <div className="flex gap-1">
              {PLINKO.ROWS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRows(r)}
                  disabled={play.isPending}
                  className={cn(
                    'flex-1 py-2 text-sm font-semibold rounded-lg border transition-colors disabled:opacity-50',
                    rows === r
                      ? 'border-primary-400/50 bg-primary-400/10 text-primary-400'
                      : 'border-border text-foreground-muted hover:border-primary-400/30',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void onPlace()}
            disabled={play.isPending || !validBet}
            className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50"
          >
            {play.isPending ? <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> : null}
            Drop Ball
          </button>

          {error && <p className="text-xs text-danger">{error}</p>}
          <p className="text-[11px] text-foreground-muted text-center">
            Server-authoritative · Provably fair
          </p>
        </Card>
        <InstantFairness game="plinko" last={last} />
      </div>
    </div>
  );
}

/** A single in-flight or settled ball, tracked by the bet id that spawned it. */
interface Ball {
  id: string;
  path: ('L' | 'R')[];
  bin: number;
  hue: string;
}

/**
 * Peg pyramid + payout bins. Each fresh result drops a ball that falls peg-row
 * by peg-row following the server's `result.path` (L/R) with gravity easing and
 * a small bounce/tick at each peg, finally dropping into `result.bin`. Multiple
 * balls stack if the user spams. Ball position is derived ONLY from the server
 * path — never randomised — and the landing bin pulses with its multiplier.
 */
function PlinkoBoard({
  rows,
  result,
  payouts,
  binColor,
  sound,
}: {
  rows: number;
  result: InstantSettleResult | null;
  payouts: number[];
  binColor: (m: number) => string;
  sound: ReturnType<typeof useGameSound>;
}) {
  const reduce = useReducedMotion();
  const [balls, setBalls] = useState<Ball[]>([]);
  // progress 0..rows per ball id (fractional row the ball is currently at).
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [pulseBin, setPulseBin] = useState<{ bin: number; at: number } | null>(null);
  const lastBetId = useRef<string | null>(null);
  const rafs = useRef<Record<string, number>>({});

  // Spawn a ball on each fresh result and animate it down the server path.
  useEffect(() => {
    if (!result || result.betId === lastBetId.current) return;
    lastBetId.current = result.betId;
    const path = (result.result?.path as ('L' | 'R')[] | undefined) ?? null;
    const bin = result.result?.bin as number | undefined;
    if (!path || typeof bin !== 'number') return;

    const id = result.betId;
    const hue = result.won ? '#10b981' : '#EE86FF';
    setBalls((prev) => [...prev.slice(-5), { id, path, bin, hue }]);

    if (reduce) {
      setProgress((p) => ({ ...p, [id]: path.length }));
      setPulseBin({ bin, at: Date.now() });
      return;
    }

    const start = performance.now();
    const perRow = 105; // ms per row — gravity-paced descent
    const total = perRow * path.length;
    let lastRow = -1;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / total);
      // accelerate (gravity): row position eases in over the fall.
      const row = path.length * (0.25 * t + 0.75 * t * t);
      setProgress((p) => ({ ...p, [id]: row }));
      const whole = Math.floor(row);
      if (whole !== lastRow && whole <= path.length) {
        lastRow = whole;
        sound.tick(420 + whole * 12, 16, 0.025);
      }
      if (t < 1) {
        rafs.current[id] = requestAnimationFrame(tick);
      } else {
        setProgress((p) => ({ ...p, [id]: path.length }));
        setPulseBin({ bin, at: Date.now() });
        sound.tick(640, 50, 0.05);
      }
    };
    rafs.current[id] = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  useEffect(
    () => () => {
      Object.values(rafs.current).forEach((r) => cancelAnimationFrame(r));
    },
    [],
  );

  const binCount = payouts.length; // rows + 1
  const pulseActive = pulseBin && Date.now() - pulseBin.at < 700 ? pulseBin.bin : null;

  return (
    <Card className="p-6 lg:p-10">
      <div className="mx-auto max-w-xl">
        {/* Board: pegs + falling balls in one positioned layer */}
        <div className="relative" style={{ aspectRatio: `${binCount} / ${rows + 1.5}` }}>
          {/* Pegs */}
          {Array.from({ length: rows }).map((_, r) => {
            const pegs = r + 1;
            const yPct = ((r + 0.5) / (rows + 1)) * 100;
            return Array.from({ length: pegs }).map((__, c) => {
              // center the row of pegs across the board width.
              const xPct = ((c + 1 - (pegs + 1) / 2) / binCount) * 100 + 50;
              return (
                <div
                  key={`${r}-${c}`}
                  className="absolute h-1.5 w-1.5 lg:h-2 lg:w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground-muted/40"
                  style={{ left: `${xPct}%`, top: `${yPct}%` }}
                />
              );
            });
          })}

          {/* Balls */}
          {balls.map((ball) => {
            const row = progress[ball.id] ?? 0;
            const whole = Math.floor(row);
            const frac = row - whole;
            // column = R-count up to current row, interpolated toward next step.
            const colAt = (k: number) => ball.path.slice(0, k).filter((d) => d === 'R').length;
            const c0 = colAt(Math.min(whole, ball.path.length));
            const next = ball.path[whole];
            const c1 = c0 + (next === 'R' ? 1 : 0);
            const col = c0 + (c1 - c0) * frac;
            // ball x sits between the pegs of the current row.
            const pegsInRow = whole + 1;
            const xPct = ((col + 0.5 - pegsInRow / 2) / binCount) * 100 + 50;
            const yPct = ((row + 0.5) / (rows + 1)) * 100;
            // tiny bounce as it crosses each peg row.
            const bounce = Math.sin(frac * Math.PI) * -3;
            return (
              <div
                key={ball.id}
                className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${xPct}%`,
                  top: `calc(${yPct}% + ${bounce}px)`,
                  background: ball.hue,
                  boxShadow: `0 0 10px ${ball.hue}cc`,
                }}
              />
            );
          })}
        </div>

        {/* Bins */}
        <div className="mt-4 flex justify-center gap-1">
          {payouts.map((m, i) => (
            <div
              key={i}
              className={cn(
                'flex-1 min-w-0 rounded-md py-1.5 text-center text-[9px] lg:text-[11px] font-bold tabular-nums transition-all',
                binColor(m),
                pulseActive === i ? 'ring-2 ring-success animate-bin-pulse' : 'opacity-80',
              )}
            >
              {m}×
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
