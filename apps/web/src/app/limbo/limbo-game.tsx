'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { LIMBO } from '@scadium/shared';
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

export function LimboGame() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const play = useInstantGame<{ amountLamports: string; target: number }>('limbo');
  const sound = useGameSound();

  const [sol, setSol] = useState('0.1');
  const [target, setTarget] = useState('2.00');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<InstantSettleResult | null>(null);

  const targetNum = Number(target) || LIMBO.MIN_TARGET;
  const winChance = Math.min(100, (1 / targetNum) * (1 - LIMBO.HOUSE_EDGE) * 100);
  const validBet = isValidBetSol(sol, LIMBO.MIN_BET_LAMPORTS);

  async function onPlace() {
    if (!isAuthenticated) {
      openWallet();
      return;
    }
    setError(null);
    const t = Math.min(LIMBO.MAX_TARGET, Math.max(LIMBO.MIN_TARGET, targetNum));
    sound.bet();
    try {
      const res = await play.mutateAsync({
        amountLamports: solToLamportsClamped(sol, LIMBO.MIN_BET_LAMPORTS, LIMBO.MAX_BET_LAMPORTS),
        target: t,
      });
      setLast(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bet failed');
    }
  }

  const result = last?.result?.result as number | undefined;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-3">
        <LimboReadout
          result={result}
          won={last?.won ?? null}
          target={last ? targetNum : null}
          betId={last?.betId ?? null}
          rolling={play.isPending}
          sound={sound}
        />
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Target" value={`${targetNum.toFixed(2)}×`} />
          <Stat label="Payout" value={`${targetNum.toFixed(2)}×`} />
          <Stat label="Win chance" value={`${winChance.toFixed(2)}%`} />
        </div>
        <WinEffect last={last} sound={sound} />
      </div>

      <div className="w-full lg:w-[300px] shrink-0 lg:pr-8 space-y-4">
        <Card className="p-5 space-y-4">
          <BetAmountInput
            sol={sol}
            setSol={setSol}
            minLamports={LIMBO.MIN_BET_LAMPORTS}
            maxLamports={LIMBO.MAX_BET_LAMPORTS}
            disabled={play.isPending}
          />

          <div>
            <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
              Target multiplier (×)
            </div>
            <input
              type="number"
              step="0.01"
              min={LIMBO.MIN_TARGET}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={play.isPending}
              placeholder="2.00"
              className="w-full rounded-xl border border-border bg-surface-elevated px-4 h-11 text-sm font-mono focus:outline-none focus:border-primary-400 disabled:opacity-50"
            />
            <div className="mt-2 flex gap-1">
              {['1.50', '2.00', '5.00', '10.00'].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setTarget(p)}
                  disabled={play.isPending}
                  className={cn(
                    'flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50',
                    target === p
                      ? 'border-primary-400/50 bg-primary-400/10 text-primary-400'
                      : 'border-border text-foreground-muted hover:border-primary-400/30',
                  )}
                >
                  {p}×
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
            Place Bet
          </button>

          {error && <p className="text-xs text-danger">{error}</p>}
          <p className="text-[11px] text-foreground-muted text-center">
            Server-authoritative · Provably fair
          </p>
        </Card>
        <InstantFairness game="limbo" last={last} />
      </div>
    </div>
  );
}

/** Big climbing-number readout; counts up to the rolled multiplier on result. */
function LimboReadout({
  result,
  won,
  target,
  betId,
  rolling,
  sound,
}: {
  result?: number;
  won: boolean | null;
  target: number | null;
  betId: string | null;
  rolling: boolean;
  sound: ReturnType<typeof useGameSound>;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(1);
  const [locked, setLocked] = useState(false);
  const raf = useRef<number | null>(null);
  const lastBetId = useRef<string | null>(null);

  useEffect(() => {
    if (result == null || betId == null || betId === lastBetId.current) return;
    lastBetId.current = betId;
    if (reduce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reduced-motion path: snap the display straight to the server's authoritative result. The effect otherwise drives a RAF count-up toward `result`; display/locked are animation state, not derivable during render.
      setDisplay(result);
      setLocked(true);
      if (won) sound.win(result);
      else sound.tick(220, 120, 0.04);
      return;
    }
    setLocked(false);
    // Rapid ease-out count UP from 1.00× to the server's result, then "lock".
    const start = performance.now();
    const duration = Math.min(1400, 500 + Math.log2(result + 1) * 220);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(1 + (result - 1) * eased);
      if (t < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        setLocked(true);
        if (won) sound.win(result);
        else sound.tick(220, 120, 0.04);
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betId]);

  const color = won == null ? 'text-foreground' : won ? 'text-success' : 'text-danger';
  const bigWin = locked && won === true && (result ?? 0) >= 10;

  return (
    <Card
      className={cn(
        'relative p-12 lg:p-20 flex flex-col items-center justify-center overflow-hidden transition-shadow',
        locked && won === true && 'shadow-[0_0_60px_rgba(16,185,129,0.35)]',
        bigWin && 'animate-screen-shake',
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-primary-400/5 to-transparent pointer-events-none" />
      {locked && won === true && (
        <div className="absolute inset-0 bg-success/10 pointer-events-none animate-seg-flash" />
      )}
      <div
        className={cn(
          'font-mono text-6xl lg:text-7xl font-black tabular-nums transition-colors',
          color,
          rolling && 'animate-instant-shimmer',
        )}
      >
        {display.toFixed(2)}×
      </div>
      {target != null && (
        <div className="relative mt-3 text-xs uppercase tracking-wider text-foreground-muted">
          Target {target.toFixed(2)}×
          {locked && won === false && <span className="ml-2 text-danger">· below target</span>}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3 text-center">
      <div className="text-[10px] uppercase tracking-wider text-foreground-muted">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-bold">{value}</div>
    </Card>
  );
}
