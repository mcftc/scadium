'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { HILO, hiloStepMultiplier, type HiloDirection } from '@scadium/shared';
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
import { useHilo, isHiloSettled, type HiloRoundView, type HiloSettleResult } from '@/hooks/use-hilo';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { ApiError } from '@/lib/api-client';
import { HiloBoard3D } from './hilo-board-3d';

export function HiloGame() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const { start, guess, cashout } = useHilo();
  const sound = useGameSound();

  const [sol, setSol] = useState('0.1');
  const [round, setRound] = useState<HiloRoundView | null>(null);
  const [settle, setSettle] = useState<HiloSettleResult | null>(null);
  const [card, setCard] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const active = round !== null;
  const busy = start.isPending || guess.isPending || cashout.isPending;
  const validBet = isValidBetSol(sol, HILO.MIN_BET_LAMPORTS);

  const rank = round?.state.rank ?? card % 13;
  const cumMult = round?.state.cumMult ?? 1;
  const steps = round?.state.steps ?? 0;
  const higherMult = hiloStepMultiplier(rank, 'higher');
  const lowerMult = hiloStepMultiplier(rank, 'lower');

  const busted = settle ? !settle.won : false;
  const celebrate = settle?.won ?? false;
  const locked = !active || busy;

  async function onStart() {
    if (!isAuthenticated) return openWallet();
    setError(null);
    setSettle(null);
    sound.bet();
    try {
      const res = await start.mutateAsync({
        amountLamports: solToLamportsClamped(sol, HILO.MIN_BET_LAMPORTS, HILO.MAX_BET_LAMPORTS),
      });
      setRound(res);
      setCard(res.state.card);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the round');
    }
  }

  async function onGuess(direction: HiloDirection) {
    if (!round || busy) return;
    setError(null);
    try {
      const res = await guess.mutateAsync({ roundId: round.roundId, direction });
      if (isHiloSettled(res)) {
        setSettle(res);
        setRound(null);
        if (res.result.nextCard !== undefined) setCard(res.result.nextCard);
        if (res.won) sound.cashout();
        else sound.lose();
      } else {
        setRound(res);
        setCard(res.state.card);
        sound.tick(560 + res.state.steps * 50);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Guess failed');
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
          <HiloBoard3D
            card={card}
            busted={busted}
            celebrate={celebrate}
            locked={locked}
            onGuess={onGuess}
          />
          <SoundToggle sound={sound} className="absolute right-4 top-4 z-10" />
          <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-border bg-background/70 px-4 py-2 backdrop-blur">
            <div className="text-2xl font-bold text-cyan-300">
              {active && steps > 0 ? cumMult.toFixed(2) : active ? '1.00' : '0.00'}×
            </div>
            <div className="text-xs text-foreground-muted">
              {settle
                ? settle.won
                  ? '✨ cashed out'
                  : '💥 busted'
                : active
                  ? `▲ ${higherMult.toFixed(2)}× · ▼ ${lowerMult.toFixed(2)}×`
                  : 'set your bet & start'}
            </div>
          </div>
        </div>
        <WinEffect last={fairnessLast} />
        <InstantFairness game="hilo" last={fairnessLast} />
      </div>

      <Card className="w-full lg:w-80 shrink-0 space-y-4 p-4">
        <BetAmountInput
          sol={sol}
          setSol={setSol}
          minLamports={HILO.MIN_BET_LAMPORTS}
          maxLamports={HILO.MAX_BET_LAMPORTS}
          disabled={active || busy}
        />

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
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onGuess('higher')}
                disabled={busy}
                className="flex h-12 items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
              >
                ▲ Higher ({higherMult.toFixed(2)}×)
              </button>
              <button
                type="button"
                onClick={() => onGuess('lower')}
                disabled={busy}
                className="flex h-12 items-center justify-center rounded-xl bg-amber-600 text-sm font-semibold text-white disabled:opacity-50"
              >
                ▼ Lower ({lowerMult.toFixed(2)}×)
              </button>
            </div>
            <button
              type="button"
              onClick={onCashout}
              disabled={busy || steps < 1}
              className="flex h-11 w-full items-center justify-center rounded-xl bg-success font-semibold text-white shadow-glow-sm disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : `Cash out ${cumMult.toFixed(2)}×`}
            </button>
          </>
        )}

        <p className="text-center text-xs text-foreground-muted">
          {active ? `streak ${steps} · guess higher-or-same / lower-or-same` : 'guess the next card after starting'}
        </p>

        {error ? <p className="text-center text-xs text-danger">{error}</p> : null}
      </Card>
    </div>
  );
}
