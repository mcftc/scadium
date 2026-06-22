'use client';

import { useMemo, useState } from 'react';
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
import { useGameSound } from '@/components/instant/use-game-sound';
import { SoundToggle } from '@/components/instant/sound-toggle';
import { useBustShake } from '@/hooks/use-bust-shake';
import { cn } from '@/lib/cn';
import type { InstantSettleResult } from '@/hooks/use-instant-game';
import { useMines, isMinesSettled, type MinesRoundView, type MinesSettleResult } from '@/hooks/use-mines';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { ApiError } from '@/lib/api-client';
import { MinesBoard3D } from './mines-board-3d';
import type { MinesCellState } from '@/components/three/mines-scene';

const CELLS = MINES.CELLS;

export function MinesGame() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const { start, pick, cashout } = useMines();
  const sound = useGameSound();

  const [sol, setSol] = useState('0.1');
  const [mineCount, setMineCount] = useState(3);
  const [round, setRound] = useState<MinesRoundView | null>(null);
  const [settle, setSettle] = useState<MinesSettleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = round !== null;
  const busy = start.isPending || pick.isPending || cashout.isPending;
  const validBet = isValidBetSol(sol, MINES.MIN_BET_LAMPORTS);

  // The mine count that governs the live board (locked once a round is running).
  const activeMines = round?.state.mineCount ?? settle?.result.mineCount ?? mineCount;
  const revealedGems = round
    ? round.state.revealed.length
    : settle
      ? settle.result.revealed.length
      : 0;
  const safeTotal = CELLS - activeMines;

  const currentMult = active && revealedGems > 0 ? minesMultiplier(activeMines, revealedGems) : 0;
  const nextMult =
    active && revealedGems < safeTotal ? minesMultiplier(activeMines, revealedGems + 1) : null;

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
  const locked = !active || busy;

  async function onStart() {
    if (!isAuthenticated) return openWallet();
    setError(null);
    setSettle(null);
    sound.bet();
    try {
      const res = await start.mutateAsync({
        amountLamports: solToLamportsClamped(sol, MINES.MIN_BET_LAMPORTS, MINES.MAX_BET_LAMPORTS),
        mines: mineCount,
      });
      setRound(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the round');
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
      setError(e instanceof ApiError ? e.message : 'Pick failed');
    }
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
      setError(e instanceof ApiError ? e.message : 'Cash out failed');
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
          <SoundToggle sound={sound} className="absolute right-4 top-4 z-10" />
          <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-border bg-background/70 px-4 py-2 backdrop-blur">
            <div className="text-2xl font-bold text-cyan-300">{currentMult.toFixed(2)}×</div>
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
      </div>

      {/* SIDE: controls */}
      <Card className="w-full lg:w-80 shrink-0 space-y-4 p-4">
        <BetAmountInput
          sol={sol}
          setSol={setSol}
          minLamports={MINES.MIN_BET_LAMPORTS}
          maxLamports={MINES.MAX_BET_LAMPORTS}
          disabled={active || busy}
        />

        <div>
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-foreground-muted">
            <span>Mines</span>
            <span className="font-bold text-foreground">
              {activeMines} / {CELLS}
            </span>
          </div>
          <input
            type="range"
            min={MINES.MIN_MINES}
            max={MINES.MAX_MINES}
            value={activeMines}
            onChange={(e) => setMineCount(Number(e.target.value))}
            disabled={active || busy}
            className="h-2 w-full cursor-pointer accent-primary-500 disabled:opacity-50"
          />
        </div>

        {!active ? (
          <button
            type="button"
            onClick={onStart}
            disabled={busy || (isAuthenticated && !validBet)}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-gradient-primary font-semibold text-white shadow-glow-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : isAuthenticated ? 'Start round' : 'Connect wallet'}
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
