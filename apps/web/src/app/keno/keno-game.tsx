'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Shuffle, Trash2 } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { KENO, KENO_RISKS, kenoHitProbability, kenoPaytable, type KenoRisk } from '@scadium/shared';
import { Card } from '@/components/ui/card';
import {
  BetAmountInput,
  isValidBetSol,
  solToLamportsClamped,
} from '@/components/instant/bet-amount-input';
import { AutoBetControls } from '@/components/instant/auto-bet-controls';
import { useAutoBet } from '@/components/instant/use-auto-bet';
import { BetModeTabs, type BetMode } from '@/components/instant/bet-mode-tabs';
import { InstantFairness } from '@/components/instant/instant-fairness';
import { RecentRounds } from '@/components/instant/recent-rounds';
import { WinEffect } from '@/components/instant/win-effect';
import { useGameSound } from '@/components/instant/use-game-sound';
import { useInstantGame, type InstantSettleResult } from '@/hooks/use-instant-game';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';

/** ms between two drawn numbers landing on the board. */
const REVEAL_STEP_MS = 110;

type KenoBody = { amountLamports: string; picks: number[]; risk: KenoRisk };

/**
 * Keno: pick up to 10 of 40 numbers, 10 are drawn server-side (provably fair,
 * `@scadium/fair` kenoDraw), and the paytable — generated from the platform
 * RTP in `@scadium/shared` — pays by hits. The draw lands number by number.
 */
export function KenoGame() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const play = useInstantGame<KenoBody>('keno');
  const sound = useGameSound();
  const reduce = useReducedMotion();

  const [sol, setSol] = useState('0.1');
  const [risk, setRisk] = useState<KenoRisk>('medium');
  const [picks, setPicks] = useState<number[]>([]);
  const [betMode, setBetMode] = useState<BetMode>('manual');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<InstantSettleResult | null>(null);
  // Drawn numbers revealed so far for the latest bet (the board animates).
  const [shown, setShown] = useState<number[]>([]);
  const [revealedBetId, setRevealedBetId] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const table = useMemo(
    () => (picks.length ? kenoPaytable(risk, picks.length) : []),
    [risk, picks.length],
  );
  const validBet = isValidBetSol(sol, KENO.MIN_BET_LAMPORTS) && picks.length >= KENO.MIN_PICKS;

  const lastDrawn = (last?.result?.drawn as number[] | undefined) ?? [];
  const lastPicks = (last?.result?.picks as number[] | undefined) ?? [];
  const done = last != null && shown.length === lastDrawn.length;
  const hitsSoFar = shown.filter((n) => lastPicks.includes(n)).length;

  // Reveal the draw number by number; the win verdict lands with the last one.
  useEffect(() => {
    if (!last) return;
    const drawn = (last.result?.drawn as number[] | undefined) ?? [];
    const pickedNow = (last.result?.picks as number[] | undefined) ?? [];
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (reduce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reduced motion: show the whole server draw at once.
      setShown(drawn);
      setRevealedBetId(last.betId);
      return;
    }
    setShown([]);
    drawn.forEach((n, i) => {
      timers.current.push(
        setTimeout(
          () => {
            setShown((s) => [...s, n]);
            if (pickedNow.includes(n)) sound.card();
            else sound.tick();
            if (i === drawn.length - 1) setRevealedBetId(last.betId);
          },
          (i + 1) * REVEAL_STEP_MS,
        ),
      );
    });
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.betId]);

  const runBet = useCallback(
    async (amountLamports: string) => {
      if (picks.length < KENO.MIN_PICKS) throw new Error('Pick at least one number');
      sound.bet();
      const res = await play.mutateAsync({ amountLamports, picks, risk });
      setLast(res);
      // Let auto-bet wait for the board to finish before the next round.
      await new Promise((r) => setTimeout(r, reduce ? 0 : (KENO.DRAWS + 2) * REVEAL_STEP_MS));
      return res;
    },
    [picks, risk, play, sound, reduce],
  );

  const auto = useAutoBet({
    runBet,
    baseStakeLamports: () =>
      BigInt(solToLamportsClamped(sol, KENO.MIN_BET_LAMPORTS, KENO.MAX_BET_LAMPORTS)),
    minLamports: KENO.MIN_BET_LAMPORTS,
    maxLamports: KENO.MAX_BET_LAMPORTS,
    onError: setError,
  });

  const busy = play.isPending || auto.running;

  function toggle(n: number) {
    if (busy) return;
    setPicks((p) =>
      p.includes(n) ? p.filter((x) => x !== n) : p.length >= KENO.MAX_PICKS ? p : [...p, n],
    );
  }

  function randomPick() {
    const pool = Array.from({ length: KENO.CELLS }, (_, i) => i + 1);
    const count = picks.length || KENO.MAX_PICKS;
    const out: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const j = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(j, 1)[0]!);
    }
    setPicks(out);
  }

  async function onPlace() {
    if (!isAuthenticated) {
      openWallet();
      return;
    }
    setError(null);
    try {
      await runBet(solToLamportsClamped(sol, KENO.MIN_BET_LAMPORTS, KENO.MAX_BET_LAMPORTS));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Bet failed');
    }
  }

  function onStartAuto(cfg: Parameters<typeof auto.start>[0]) {
    if (!isAuthenticated) {
      openWallet();
      return;
    }
    setError(null);
    void auto.start(cfg);
  }

  // The board shows the latest draw only while the picks are the ones it was played with.
  const boardDrawn = new Set(shown);
  const settledHits = done ? (last?.result?.hits as number | undefined) : undefined;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-4">
        <Card className="relative overflow-hidden p-3 sm:p-5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary-400/5 to-transparent" />
          <div className="relative mx-auto grid max-w-[640px] grid-cols-8 gap-1.5 sm:gap-2">
            {Array.from({ length: KENO.CELLS }, (_, i) => i + 1).map((n) => {
              const picked = picks.includes(n);
              const drawn = boardDrawn.has(n);
              const hit = picked && drawn;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggle(n)}
                  disabled={busy}
                  aria-pressed={picked}
                  aria-label={`Number ${n}${picked ? ', picked' : ''}${drawn ? ', drawn' : ''}`}
                  className={cn(
                    'relative aspect-square rounded-lg sm:rounded-xl border text-sm sm:text-base font-bold font-mono tabular-nums transition-all duration-150',
                    'disabled:cursor-default',
                    hit
                      ? 'border-emerald-300 bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-[0_0_18px_rgba(16,185,129,0.6)] scale-105'
                      : picked
                        ? 'border-primary-400/70 bg-primary-400/25 text-white shadow-[0_0_12px_rgba(168,85,247,0.35)]'
                        : drawn
                          ? 'border-border bg-surface-elevated text-foreground-muted/40'
                          : 'border-border/70 bg-surface-elevated/70 text-foreground-muted hover:border-primary-400/40 hover:text-foreground',
                  )}
                >
                  {drawn && !picked && (
                    <span className="absolute inset-1.5 rounded-full border-2 border-danger/50" />
                  )}
                  <span className="relative">{n}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Paytable
          table={table}
          picks={picks.length}
          activeHits={settledHits}
          liveHits={last && !done ? hitsSoFar : undefined}
        />
        <WinEffect last={last && last.betId === revealedBetId ? last : null} sound={sound} />
      </div>

      <div className="w-full lg:w-[300px] shrink-0 space-y-4">
        <Card className="p-5 space-y-4">
          <BetModeTabs mode={betMode} setMode={setBetMode} disabled={auto.running} />
          <BetAmountInput
            sol={sol}
            setSol={setSol}
            minLamports={KENO.MIN_BET_LAMPORTS}
            maxLamports={KENO.MAX_BET_LAMPORTS}
            disabled={busy}
          />
          <div>
            <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">Risk</div>
            <div className="grid grid-cols-3 gap-1">
              {KENO_RISKS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRisk(r)}
                  disabled={busy}
                  className={cn(
                    'py-2 text-xs font-semibold capitalize rounded-lg border transition-colors disabled:opacity-50',
                    risk === r
                      ? 'border-primary-400/50 bg-primary-400/10 text-primary-400'
                      : 'border-border text-foreground-muted hover:border-primary-400/30',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-foreground-muted">
            <span>
              Picked{' '}
              <span className="font-mono text-foreground">
                {picks.length}/{KENO.MAX_PICKS}
              </span>
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={randomPick}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 hover:border-primary-400/40 disabled:opacity-50"
              >
                <Shuffle className="h-3 w-3" /> Auto pick
              </button>
              <button
                type="button"
                onClick={() => setPicks([])}
                disabled={busy || picks.length === 0}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 hover:border-danger/40 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            </div>
          </div>
          {betMode === 'manual' ? (
            <button
              type="button"
              onClick={() => void onPlace()}
              disabled={play.isPending || !validBet}
              className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50"
            >
              {play.isPending ? <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> : null}
              {picks.length ? 'Place Bet' : 'Pick numbers'}
            </button>
          ) : (
            <AutoBetControls
              running={auto.running}
              betsRemaining={auto.betsRemaining}
              sessionProfitLamports={auto.sessionProfitLamports}
              currentStakeLamports={auto.currentStakeLamports}
              canStart={validBet}
              onStart={onStartAuto}
              onStop={auto.stop}
            />
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <p className="text-[11px] text-foreground-muted text-center">
            Server-authoritative · Provably fair
          </p>
        </Card>
        <RecentRounds game="keno" />
        <InstantFairness game="keno" last={last} />
      </div>
    </div>
  );
}

/** Multiplier per hit count for the current picks and risk; highlights the result. */
function Paytable({
  table,
  picks,
  activeHits,
  liveHits,
}: {
  table: number[];
  picks: number;
  activeHits?: number;
  liveHits?: number;
}) {
  if (picks === 0) {
    return (
      <Card className="p-4 text-center text-sm text-foreground-muted">
        Pick 1 to {KENO.MAX_PICKS} numbers — the paytable appears here.
      </Card>
    );
  }
  return (
    <Card className="p-2 sm:p-3">
      <div className="flex gap-1 overflow-x-auto">
        {table.map((m, h) => {
          const active = activeHits === h;
          const live = activeHits == null && liveHits === h;
          return (
            <div
              key={h}
              className={cn(
                'min-w-[3.25rem] flex-1 rounded-lg border px-1 py-1.5 text-center transition-colors',
                active
                  ? m > 0
                    ? 'border-emerald-400 bg-emerald-500/20'
                    : 'border-danger/50 bg-danger/10'
                  : live
                    ? 'border-primary-400/50 bg-primary-400/10'
                    : 'border-border bg-surface-elevated/60',
              )}
            >
              <div
                className={cn(
                  'font-mono text-xs sm:text-sm font-bold',
                  m > 0 ? 'text-foreground' : 'text-foreground-muted/50',
                )}
              >
                {m > 0 ? `${m >= 1000 ? m.toFixed(0) : m.toFixed(2)}×` : '0×'}
              </div>
              <div className="text-[10px] text-foreground-muted">
                {h} hit{h === 1 ? '' : 's'} ·{' '}
                {(kenoHitProbability(picks, h) * 100).toFixed(h > 6 ? 4 : 1)}%
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
