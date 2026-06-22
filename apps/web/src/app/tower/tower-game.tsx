'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { TOWER, towerMultiplier } from '@scadium/shared';
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
import { useTower, isTowerSettled, type TowerRoundView, type TowerSettleResult } from '@/hooks/use-tower';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { ApiError } from '@/lib/api-client';
import { TowerBoard3D } from './tower-board-3d';
import type { TowerCellState } from '@/components/three/tower-scene';

const ROWS = TOWER.ROWS;
const COLS = TOWER.COLUMNS;

export function TowerGame() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const { start, pick, cashout } = useTower();
  const sound = useGameSound();

  const [sol, setSol] = useState('0.1');
  const [round, setRound] = useState<TowerRoundView | null>(null);
  const [settle, setSettle] = useState<TowerSettleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = round !== null;
  const busy = start.isPending || pick.isPending || cashout.isPending;
  const validBet = isValidBetSol(sol, TOWER.MIN_BET_LAMPORTS);
  const currentRow = round?.state.currentRow ?? 0;

  const currentMult = active && currentRow > 0 ? towerMultiplier(currentRow) : 0;
  const nextMult = active && currentRow < ROWS ? towerMultiplier(currentRow + 1) : null;

  // Map the server's round/settle state onto the flat ROWS×COLS board.
  const cells = useMemo<TowerCellState[]>(() => {
    const out: TowerCellState[] = Array.from({ length: ROWS * COLS }, () => 'locked');
    if (settle) {
      settle.result.picks.forEach((c, r) => (out[r * COLS + c] = 'safe'));
      settle.result.traps.forEach((cols, r) =>
        cols.forEach((c) => {
          if (out[r * COLS + c] !== 'safe') out[r * COLS + c] = 'trap';
        }),
      );
    } else if (round) {
      const { currentRow: cr, picks } = round.state;
      for (let r = 0; r < ROWS; r += 1) {
        if (r < cr) out[r * COLS + (picks[r] ?? 0)] = 'safe';
        else if (r === cr) for (let c = 0; c < COLS; c += 1) out[r * COLS + c] = 'active';
      }
    }
    return out;
  }, [round, settle]);

  const celebrate = settle?.won ?? false;
  const locked = !active || busy;

  async function onStart() {
    if (!isAuthenticated) return openWallet();
    setError(null);
    setSettle(null);
    sound.bet();
    try {
      const res = await start.mutateAsync({
        amountLamports: solToLamportsClamped(sol, TOWER.MIN_BET_LAMPORTS, TOWER.MAX_BET_LAMPORTS),
      });
      setRound(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the round');
    }
  }

  async function onPick(_row: number, column: number) {
    if (!round || busy) return;
    setError(null);
    try {
      const res = await pick.mutateAsync({ roundId: round.roundId, column });
      if (isTowerSettled(res)) {
        setSettle(res);
        setRound(null);
        if (res.won) sound.cashout();
        else sound.lose();
      } else {
        setRound(res);
        sound.tick(560 + res.state.currentRow * 55);
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

  const fairnessLast: InstantSettleResult | null = settle
    ? { ...settle, amountLamports: settle.stakeLamports }
    : null;
  const shaking = useBustShake(settle && !settle.won ? settle.betId : null);

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-3">
        <div
          className={cn(
            'relative overflow-hidden rounded-2xl border border-border bg-background',
            shaking && 'animate-screen-shake',
          )}
        >
          <TowerBoard3D
            rows={ROWS}
            columns={COLS}
            cells={cells}
            celebrate={celebrate}
            locked={locked}
            onPick={onPick}
          />
          <SoundToggle sound={sound} className="absolute right-2 top-2 z-10 sm:right-4 sm:top-4" />
          <div className="pointer-events-none absolute left-2 top-2 rounded-xl border border-border bg-background/70 px-3 py-1.5 backdrop-blur sm:left-4 sm:top-4 sm:px-4 sm:py-2">
            <div className="text-xl font-bold text-emerald-300 sm:text-2xl">{currentMult.toFixed(2)}×</div>
            <div className="text-xs text-foreground-muted">
              {settle
                ? settle.won
                  ? '✨ cashed out'
                  : '💥 busted'
                : active
                  ? nextMult !== null
                    ? `next row → ${nextMult.toFixed(2)}×`
                    : ''
                  : 'set your bet & start'}
            </div>
          </div>
        </div>
        <WinEffect last={fairnessLast} />
        <InstantFairness game="tower" last={fairnessLast} />
        <RecentRounds game="tower" />
      </div>

      <Card className="w-full lg:w-80 shrink-0 space-y-4 p-4">
        <BetAmountInput
          sol={sol}
          setSol={setSol}
          minLamports={TOWER.MIN_BET_LAMPORTS}
          maxLamports={TOWER.MAX_BET_LAMPORTS}
          disabled={active || busy}
        />

        <div className="rounded-xl border border-border bg-surface-elevated/50 px-3 py-2 text-xs text-foreground-muted">
          {ROWS} rows · {COLS} tiles/row · {COLS - TOWER.SAFE_PER_ROW} trap per row
        </div>

        {!active ? (
          <button
            type="button"
            onClick={onStart}
            disabled={busy || (isAuthenticated && !validBet)}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-gradient-primary font-semibold text-white shadow-glow-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : isAuthenticated ? 'Start climb' : 'Connect wallet'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onCashout}
            disabled={busy || currentRow < 1}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-success font-semibold text-white shadow-glow-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : `Cash out ${currentMult.toFixed(2)}×`}
          </button>
        )}

        <p className="text-center text-xs text-foreground-muted">
          {active ? `pick a tile in the lit row · climbed ${currentRow}/${ROWS}` : 'climb row by row after starting'}
        </p>

        {error ? <p className="text-center text-xs text-danger">{error}</p> : null}
      </Card>
    </div>
  );
}
