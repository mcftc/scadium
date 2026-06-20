'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { DICE, diceMultiplier } from '@scadium/shared';
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

export function DiceGame() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const play = useInstantGame<{ amountLamports: string; target: number }>('dice');
  const sound = useGameSound();

  const [sol, setSol] = useState('0.1');
  const [target, setTarget] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<InstantSettleResult | null>(null);

  const winChance = target / 100;
  const multiplier = diceMultiplier(target);
  const validBet = isValidBetSol(sol, DICE.MIN_BET_LAMPORTS);

  async function onPlace() {
    if (!isAuthenticated) {
      openWallet();
      return;
    }
    setError(null);
    try {
      const res = await play.mutateAsync({
        amountLamports: solToLamportsClamped(sol, DICE.MIN_BET_LAMPORTS, DICE.MAX_BET_LAMPORTS),
        target,
      });
      setLast(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bet failed');
    }
  }

  const roll = last?.result?.roll as number | undefined;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* CENTER: visual */}
      <div className="flex-1 min-w-0 space-y-3">
        <DiceTrack
          target={target}
          setTarget={setTarget}
          roll={roll}
          won={last?.won ?? null}
          betId={last?.betId ?? null}
          rolling={play.isPending}
          sound={sound}
        />
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Multiplier" value={`${multiplier.toFixed(2)}×`} />
          <Stat label="Roll under" value={target.toFixed(0)} />
          <Stat label="Win chance" value={`${(winChance * 100).toFixed(2)}%`} />
        </div>
        <WinEffect last={last} sound={sound} />
      </div>

      {/* RIGHT: bet panel */}
      <div className="w-full lg:w-[300px] shrink-0 lg:pr-8 space-y-4">
        <Card className="p-5 space-y-4">
          <BetAmountInput
            sol={sol}
            setSol={setSol}
            minLamports={DICE.MIN_BET_LAMPORTS}
            maxLamports={DICE.MAX_BET_LAMPORTS}
            disabled={play.isPending}
          />

          <div>
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-foreground-muted mb-2">
              <span>Roll under</span>
              <span className="font-mono text-foreground">{target}</span>
            </div>
            <input
              type="range"
              min={DICE.MIN_TARGET}
              max={DICE.MAX_TARGET}
              step={1}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              disabled={play.isPending}
              className="w-full accent-primary-400"
            />
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
        <InstantFairness game="dice" last={last} />
      </div>
    </div>
  );
}

/** Number line with the roll-under threshold marker + the landed roll pin. */
function DiceTrack({
  target,
  setTarget,
  roll,
  won,
  betId,
  rolling,
  sound,
}: {
  target: number;
  setTarget: (n: number) => void;
  roll?: number;
  won: boolean | null;
  betId: string | null;
  rolling: boolean;
  sound: ReturnType<typeof useGameSound>;
}) {
  const reduce = useReducedMotion();
  // Animate the pin toward the server's rolled value when a new roll lands.
  const [pin, setPin] = useState<number | null>(null);
  const raf = useRef<number | null>(null);
  const lastBetId = useRef<string | null>(null);

  useEffect(() => {
    if (roll == null || betId == null || betId === lastBetId.current) return;
    lastBetId.current = betId;
    sound.tick(won ? 760 : 320, 90, 0.05);
    if (reduce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reduced-motion path: snap the pin straight to the server's authoritative roll. The effect otherwise drives a RAF animation toward `roll`; the pin is animation state, not derivable during render.
      setPin(roll);
      return;
    }
    // Spring-like ease toward the authoritative roll (ease-out cubic, slight
    // overshoot near the target marker for a satisfying settle).
    const start = performance.now();
    const from = pin ?? 0;
    const duration = 500;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setPin(from + (roll - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betId]);

  return (
    <Card className="p-8 lg:p-12">
      <div className="relative h-24">
        {/* Track */}
        <div className="absolute top-1/2 left-0 right-0 h-3 -translate-y-1/2 rounded-full overflow-hidden bg-surface-elevated">
          <div
            className="absolute inset-y-0 left-0 bg-success/70"
            style={{ width: `${target}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-danger/40"
            style={{ width: `${100 - target}%` }}
          />
        </div>
        {/* Threshold handle (draggable via the slider, click track to nudge) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
          style={{ left: `${target}%` }}
        >
          <div className="h-9 w-2 rounded-full bg-primary-400 shadow-[0_0_12px_rgba(238,134,255,0.6)]" />
        </div>
        {/* Landed roll pin */}
        {pin != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 transition-none"
            style={{ left: `${Math.min(100, Math.max(0, pin))}%` }}
          >
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full border-2 font-bold text-sm tabular-nums transition-colors',
                rolling && 'animate-instant-shimmer',
                won == null
                  ? 'border-border bg-surface'
                  : won
                    ? 'border-success bg-success/20 text-success'
                    : 'border-danger bg-danger/20 text-danger',
              )}
            >
              {pin.toFixed(0)}
            </div>
          </div>
        )}
        {/* Scale labels */}
        <div className="absolute -bottom-2 left-0 right-0 flex justify-between text-[10px] font-mono text-foreground-muted">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>
      {/* keep a click target so the slider isn't the only way to move */}
      <input
        type="range"
        min={DICE.MIN_TARGET}
        max={DICE.MAX_TARGET}
        value={target}
        onChange={(e) => setTarget(Number(e.target.value))}
        className="mt-6 w-full accent-primary-400 lg:hidden"
        aria-label="Roll-under target"
      />
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
