'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { MINES, minesMultiplier } from '@scadium/shared';
import { Card } from '@/components/ui/card';
import {
  BetAmountInput,
  isValidBetSol,
  solToLamportsClamped,
} from '@/components/instant/bet-amount-input';
import { InstantFairness } from '@/components/instant/instant-fairness';
import { WinEffect } from '@/components/instant/win-effect';
import { RecentRounds } from '@/components/instant/recent-rounds';
import { useGameSound } from '@/components/instant/use-game-sound';
import { SoundToggle } from '@/components/instant/sound-toggle';
import { useBustShake } from '@/hooks/use-bust-shake';
import { cn } from '@/lib/cn';
import type { InstantSettleResult } from '@/hooks/use-instant-game';
import {
  useMines,
  isMinesSettled,
  type MinesRoundView,
  type MinesSettleResult,
} from '@/hooks/use-mines';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { ApiError } from '@/lib/api-client';
import { MinesBoard3D } from './mines-board-3d';
import type { MinesCellState } from '@/components/three/mines-scene';

const CELLS = MINES.CELLS;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function MinesGame() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const { start, pick, cashout, active: activeQuery, resetActive } = useMines();
  const sound = useGameSound();

  const [sol, setSol] = useState('0.1');
  const [mineCount, setMineCount] = useState(3);
  const [round, setRound] = useState<MinesRoundView | null>(null);
  const [settle, setSettle] = useState<MinesSettleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Auto mode: reveal N random tiles then cash out, one round per press.
  const [autoMode, setAutoMode] = useState(false);
  const [autoTiles, setAutoTiles] = useState(3);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoRunningRef = useRef(false);

  const active = round !== null;
  const busy = start.isPending || pick.isPending || cashout.isPending;
  const validBet = isValidBetSol(sol, MINES.MIN_BET_LAMPORTS);

  // Resume a server-side open round after a reload/navigation — the stake was
  // debited at start, and without hydration every new start 409s forever.
  useEffect(() => {
    if (round === null && settle === null && activeQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration of the server's open round into local round state on mount/refetch; guarded so it never overwrites live play.
      setRound(activeQuery.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery.data]);

  // The mine count that governs the live board (locked once a round is running).
  const activeMines = round?.state.mineCount ?? settle?.result.mineCount ?? mineCount;
  // The slider is the NEXT round's config once no round is live — binding it to
  // the settled round's count made it look frozen while silently diverging from
  // the value actually sent to /mines/start.
  const sliderMines = round ? round.state.mineCount : mineCount;
  const revealedGems = round
    ? round.state.revealed.length
    : settle
      ? settle.result.revealed.length
      : 0;
  const safeTotal = CELLS - activeMines;

  const currentMult = active && revealedGems > 0 ? minesMultiplier(activeMines, revealedGems) : 0;
  const nextMult =
    active && revealedGems < safeTotal ? minesMultiplier(activeMines, revealedGems + 1) : null;
  // Best case for the selected mine count: every safe tile revealed.
  const maxMult = minesMultiplier(sliderMines, CELLS - sliderMines);
  const maxAutoTiles = CELLS - sliderMines;
  const clampedAutoTiles = Math.min(autoTiles, maxAutoTiles);

  // Build the 25-cell board the 3D scene renders from the server's round state.
  const cells = useMemo<MinesCellState[]>(() => {
    const out: MinesCellState[] = Array.from({ length: CELLS }, () => 'hidden');
    if (settle) {
      for (const m of settle.result.mines) out[m] = 'bomb';
      for (const g of settle.result.revealed) out[g] = 'gem';
    } else if (round) {
      for (const g of round.state.revealed) out[g] = 'gem';
    }
    return out;
  }, [round, settle]);

  const bustCell = settle?.result.hitMine ?? null;
  const celebrate = settle?.won ?? false;
  const locked = !active || busy || autoRunning;

  async function startRound(): Promise<MinesRoundView | null> {
    setError(null);
    setSettle(null);
    sound.bet();
    try {
      const res = await start.mutateAsync({
        amountLamports: solToLamportsClamped(sol, MINES.MIN_BET_LAMPORTS, MINES.MAX_BET_LAMPORTS),
        mines: mineCount,
      });
      setRound(res);
      return res;
    } catch (e) {
      // Self-heal a 409: an open round already exists server-side — resume it
      // instead of leaving the player stuck behind "already in progress".
      if (e instanceof ApiError && e.status === 409) {
        const cur = await activeQuery.refetch();
        if (cur.data) {
          setRound(cur.data);
          return null;
        }
      }
      setError(e instanceof ApiError ? e.message : 'Could not start the round');
      return null;
    }
  }

  async function onStart() {
    if (!isAuthenticated) return openWallet();
    await startRound();
  }

  /** One auto round: start, reveal N random tiles, cash out (or bust). */
  async function onAutoRound() {
    if (!isAuthenticated) return openWallet();
    const res = await startRound();
    if (!res) return;
    setAutoRunning(true);
    autoRunningRef.current = true;
    try {
      const order = Array.from({ length: CELLS }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      const tiles = order.slice(0, Math.min(clampedAutoTiles, CELLS - res.state.mineCount));
      for (const cell of tiles) {
        if (!autoRunningRef.current) return; // stopped — leave the round for manual play
        await sleep(350); // paces the reveal animation and stays under the bet throttle
        // Re-check AFTER the delay: a Stop pressed during the sleep must cancel
        // the pending reveal, or one more tile flips (and can bust) post-Stop.
        if (!autoRunningRef.current) return;
        const r = await pick.mutateAsync({ roundId: res.roundId, cell });
        if (isMinesSettled(r)) {
          setSettle(r);
          setRound(null);
          if (r.won) sound.cashout();
          else sound.lose();
          return;
        }
        setRound(r);
        sound.tick(560 + r.state.revealed.length * 45);
      }
      if (!autoRunningRef.current) return;
      const r = await cashout.mutateAsync({ roundId: res.roundId });
      setSettle(r);
      setRound(null);
      sound.cashout();
    } catch (e) {
      handleRoundError(e, 'Auto round failed');
    } finally {
      setAutoRunning(false);
      autoRunningRef.current = false;
    }
  }

  async function onReveal(cell: number) {
    if (!round || busy) return;
    setError(null);
    try {
      const res = await pick.mutateAsync({ roundId: round.roundId, cell });
      if (isMinesSettled(res)) {
        setSettle(res);
        setRound(null);
        if (res.won) sound.cashout();
        else sound.lose();
      } else {
        setRound(res);
        // rising tick per safe reveal — brighter as the multiplier climbs
        sound.tick(560 + res.state.revealed.length * 45);
      }
    } catch (e) {
      handleRoundError(e, 'Pick failed');
    }
  }

  /**
   * If a pick/cashout hits a round that no longer exists server-side (409/404 —
   * e.g. this client hydrated a round that was settled in another tab), drop the
   * phantom round and its cached active entry so the board returns to a fresh
   * Start state instead of wedging on a Cashout button that can never succeed.
   */
  function handleRoundError(e: unknown, fallback: string) {
    if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
      setRound(null);
      resetActive();
      setError('That round already ended — start a new one.');
      return;
    }
    setError(e instanceof ApiError ? e.message : fallback);
  }

  async function onCashout() {
    if (!round || busy) return;
    setError(null);
    try {
      const res = await cashout.mutateAsync({ roundId: round.roundId });
      setSettle(res);
      setRound(null);
      sound.cashout();
    } catch (e) {
      handleRoundError(e, 'Cash out failed');
    }
  }

  // Adapt the settle result to the shared fairness/win components.
  const fairnessLast: InstantSettleResult | null = settle
    ? { ...settle, amountLamports: settle.stakeLamports }
    : null;
  const shaking = useBustShake(settle && !settle.won ? settle.betId : null);

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* CENTER: the 3D board */}
      <div className="flex-1 min-w-0 space-y-3">
        <div
          className={cn(
            'relative overflow-hidden rounded-2xl border border-border bg-background',
            shaking && 'animate-screen-shake',
          )}
        >
          <MinesBoard3D
            cells={cells}
            bustCell={bustCell}
            celebrate={celebrate}
            locked={locked}
            onReveal={onReveal}
          />
          <SoundToggle sound={sound} className="absolute right-2 top-2 z-10 sm:right-4 sm:top-4" />
          <div className="pointer-events-none absolute left-2 top-2 rounded-xl border border-border bg-background/70 px-3 py-1.5 backdrop-blur sm:left-4 sm:top-4 sm:px-4 sm:py-2">
            <div className="text-xl font-bold text-cyan-300 sm:text-2xl">
              {(settle ? settle.multiplier : currentMult).toFixed(2)}×
            </div>
            <div className="text-xs text-foreground-muted">
              {settle
                ? settle.won
                  ? '✨ cashed out'
                  : '💥 busted'
                : active
                  ? nextMult !== null
                    ? `next gem → ${nextMult.toFixed(2)}×`
                    : ''
                  : 'set your bet & start'}
            </div>
          </div>
        </div>
        <WinEffect last={fairnessLast} />
        <InstantFairness game="mines" last={fairnessLast} />
        <RecentRounds game="mines" />
      </div>

      {/* SIDE: controls */}
      <Card className="w-full lg:w-80 shrink-0 space-y-4 p-4">
        <BetAmountInput
          sol={sol}
          setSol={setSol}
          minLamports={MINES.MIN_BET_LAMPORTS}
          maxLamports={MINES.MAX_BET_LAMPORTS}
          disabled={active || busy || autoRunning}
        />

        <div>
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-foreground-muted">
            <span>Mines</span>
            <span className="font-bold text-foreground">
              {sliderMines} / {CELLS}
            </span>
          </div>
          <input
            type="range"
            min={MINES.MIN_MINES}
            max={MINES.MAX_MINES}
            value={sliderMines}
            onChange={(e) => setMineCount(Number(e.target.value))}
            disabled={active || busy || autoRunning}
            className="h-2 w-full cursor-pointer accent-primary-500 disabled:opacity-50"
          />
          <p className="mt-2 flex items-center justify-between text-[11px] text-foreground-muted">
            <span>max win (all {CELLS - sliderMines} gems)</span>
            <span className="font-mono font-bold text-cyan-300">
              {maxMult.toLocaleString('en-US', { maximumFractionDigits: 2 })}×
            </span>
          </p>
        </div>

        <div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-elevated p-1">
            {(['manual', 'auto'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAutoMode(m === 'auto')}
                disabled={active || busy || autoRunning}
                className={cn(
                  'h-8 rounded-md text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50',
                  (m === 'auto') === autoMode
                    ? 'bg-primary-500/30 text-foreground'
                    : 'text-foreground-muted hover:text-foreground',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {autoMode && (
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="uppercase tracking-wider text-foreground-muted">
                Tiles per round
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={autoRunning || clampedAutoTiles <= 1}
                  onClick={() => setAutoTiles(Math.max(1, clampedAutoTiles - 1))}
                  className="h-6 w-6 rounded-md bg-surface-elevated font-bold disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-6 text-center font-mono font-bold">{clampedAutoTiles}</span>
                <button
                  type="button"
                  disabled={autoRunning || clampedAutoTiles >= maxAutoTiles}
                  onClick={() => setAutoTiles(Math.min(maxAutoTiles, clampedAutoTiles + 1))}
                  className="h-6 w-6 rounded-md bg-surface-elevated font-bold disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>

        {autoRunning ? (
          <button
            type="button"
            onClick={() => {
              autoRunningRef.current = false;
            }}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-danger/80 font-semibold text-white shadow-glow-sm"
          >
            Stop auto
          </button>
        ) : !active ? (
          <button
            type="button"
            onClick={autoMode ? onAutoRound : onStart}
            disabled={busy || (isAuthenticated && !validBet)}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-gradient-primary font-semibold text-white shadow-glow-sm disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : !isAuthenticated ? (
              'Connect wallet'
            ) : autoMode ? (
              `Start auto (${clampedAutoTiles} tiles)`
            ) : (
              'Start round'
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onCashout}
            disabled={busy || revealedGems < 1}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-success font-semibold text-white shadow-glow-sm disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              `Cash out ${currentMult.toFixed(2)}×`
            )}
          </button>
        )}

        <p className="text-center text-xs text-foreground-muted">
          {active
            ? `click a tile · gems ${revealedGems}/${safeTotal}`
            : 'pick a tile after starting to reveal a gem'}
        </p>

        {error ? <p className="text-center text-xs text-danger">{error}</p> : null}
      </Card>
    </div>
  );
}
