'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { WHEEL, WHEEL_PAYOUT_BUCKETS, WHEEL_SEGMENTS } from '@scadium/shared';
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
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Color a segment by its multiplier tier. */
// Tier bands chosen so both the raw bucket shape (5/3/2/1.5/1.2) and the
// RTP-scaled payouts (≈4.92/2.95/1.96/1.47/1.18) map to the same colour tier.
function tierColor(m: number): string {
  if (m >= 4) return '#FFBE3D';
  if (m >= 2.5) return '#F5A623';
  if (m >= 1.8) return '#DB8A12';
  if (m >= 1.35) return '#B26B0C';
  if (m >= 1.05) return '#8A5209';
  return '#2A2E3C';
}

export function WheelGame() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const play = useInstantGame<{ amountLamports: string }>('wheel');
  const sound = useGameSound();

  const [sol, setSol] = useState('0.1');
  const [betMode, setBetMode] = useState<BetMode>('manual');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<InstantSettleResult | null>(null);
  // The result is revealed (celebration + win amount) only when the wheel
  // actually stops — `last` drives the spin, `settled` drives WinEffect.
  const [settled, setSettled] = useState<InstantSettleResult | null>(null);

  const validBet = isValidBetSol(sol, WHEEL.MIN_BET_LAMPORTS);

  // Place ONE bet at the given stake; throws on failure (the auto-bet loop stops
  // on the throw). Clears the prior reveal first so the wheel re-spins cleanly.
  // Shared by manual + auto.
  const runBet = useCallback(
    async (amountLamports: string) => {
      setSettled(null);
      sound.bet();
      const res = await play.mutateAsync({ amountLamports });
      setLast(res);
      return res;
    },
    [play, sound],
  );

  const auto = useAutoBet({
    runBet,
    baseStakeLamports: () =>
      BigInt(solToLamportsClamped(sol, WHEEL.MIN_BET_LAMPORTS, WHEEL.MAX_BET_LAMPORTS)),
    minLamports: WHEEL.MIN_BET_LAMPORTS,
    maxLamports: WHEEL.MAX_BET_LAMPORTS,
    onError: setError,
  });

  async function onPlace() {
    if (!isAuthenticated) {
      openWallet();
      return;
    }
    setError(null);
    try {
      await runBet(solToLamportsClamped(sol, WHEEL.MIN_BET_LAMPORTS, WHEEL.MAX_BET_LAMPORTS));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bet failed');
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

  const busy = play.isPending || auto.running;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-4 lg:min-h-[calc(100vh-12rem)] lg:flex lg:flex-col lg:justify-center">
        <Wheel
          result={last}
          revealed={settled}
          tierColor={tierColor}
          sound={sound}
          onLanded={() => setSettled(last)}
        />
        {/* Bucket legend */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {WHEEL_PAYOUT_BUCKETS.map((b) => (
            <div
              key={b.multiplier}
              className="rounded-lg border border-border p-2 text-center"
              style={{ borderColor: `${tierColor(b.multiplier)}55` }}
            >
              <div
                className="font-mono text-sm font-bold"
                style={{ color: tierColor(b.multiplier) }}
              >
                {b.multiplier}×
              </div>
              <div className="text-[9px] text-foreground-muted">
                {((b.weight / WHEEL_SEGMENTS) * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
        <WinEffect last={settled} sound={sound} />
      </div>

      <div className="w-full lg:w-[300px] shrink-0 lg:pr-8 space-y-4">
        <Card className="p-5 space-y-4">
          <BetModeTabs mode={betMode} setMode={setBetMode} disabled={auto.running} />

          <BetAmountInput
            sol={sol}
            setSol={setSol}
            minLamports={WHEEL.MIN_BET_LAMPORTS}
            maxLamports={WHEEL.MAX_BET_LAMPORTS}
            disabled={busy}
          />

          {betMode === 'manual' ? (
            <button
              type="button"
              onClick={() => void onPlace()}
              disabled={play.isPending || !validBet}
              className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50"
            >
              {play.isPending ? <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> : null}
              Spin
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
        <RecentRounds game="wheel" />
        <InstantFairness game="wheel" last={last} />
      </div>
    </div>
  );
}

/**
 * SVG wheel rendered from WHEEL_PAYOUT_BUCKETS expanded by weight into WHEEL_SEGMENTS
 * slices. On a result we rotate so the server's `result.index` slice lands under
 * the top pointer, plus several full turns for the spin feel.
 */
function Wheel({
  result,
  revealed,
  tierColor,
  sound,
  onLanded,
}: {
  result: InstantSettleResult | null;
  /** The parent-owned revealed result — null while the wheel is still moving. */
  revealed: InstantSettleResult | null;
  tierColor: (m: number) => string;
  sound: ReturnType<typeof useGameSound>;
  onLanded?: () => void;
}) {
  const reduce = useReducedMotion();
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [landedIndex, setLandedIndex] = useState<number | null>(null);
  const spins = useRef(0);
  const raf = useRef<number | null>(null);
  const lastBetId = useRef<string | null>(null);

  const segAngle = 360 / WHEEL_SEGMENTS;
  // Flatten buckets into per-segment slices (index → multiplier).
  const slices: { mult: number }[] = [];
  for (const b of WHEEL_PAYOUT_BUCKETS) {
    for (let i = 0; i < b.weight; i += 1) slices.push({ mult: b.multiplier });
  }

  useEffect(() => {
    if (!result || result.betId === lastBetId.current) return;
    lastBetId.current = result.betId;
    const index = result.result?.index as number;
    if (typeof index !== 'number') {
      onLanded?.(); // never let a malformed result swallow the payout reveal
      return;
    }

    // Always land the server's exact segment under the top pointer.
    const sliceCenter = index * segAngle + segAngle / 2;
    spins.current += reduce ? 0 : 5;
    const from = angle;
    const target = spins.current * 360 - sliceCenter;

    if (reduce) {
      setAngle(target);
      setLandedIndex(index);
      onLanded?.();
      return;
    }

    setLandedIndex(null);
    setSpinning(true);
    const start = performance.now();
    const duration = 3600;
    let lastTickSeg = -1;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out quint for a long, decelerating spin.
      const eased = 1 - Math.pow(1 - t, 5);
      const a = from + (target - from) * eased;
      setAngle(a);
      // Ratchet tick each time a new segment passes the pointer.
      const seg = Math.floor((((a % 360) + 360) % 360) / segAngle);
      if (seg !== lastTickSeg) {
        lastTickSeg = seg;
        sound.tick(520, 18, 0.03);
      }
      if (t < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        setSpinning(false);
        setLandedIndex(index);
        onLanded?.();
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const R = 150;
  const C = 160;
  // Round to fixed precision so SSR and client render byte-identical paths
  // (prevents the React hydration mismatch from full-precision trig output).
  const fx = (n: number) => Math.round(n * 1000) / 1000;

  return (
    <Card className="p-6 lg:p-12 flex items-center justify-center">
      <div className="relative w-full max-w-[460px] aspect-square">
        {/* Pointer */}
        <div className="absolute left-1/2 -top-1 z-20 -translate-x-1/2">
          <div className="h-0 w-0 border-x-[13px] border-x-transparent border-t-[20px] border-t-[#FFBE3D]" />
        </div>
        <svg
          viewBox="0 0 320 320"
          width="100%"
          height="100%"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          {slices.map((s, i) => {
            const a0 = (i * segAngle - 90) * (Math.PI / 180);
            const a1 = ((i + 1) * segAngle - 90) * (Math.PI / 180);
            const x0 = fx(C + R * Math.cos(a0));
            const y0 = fx(C + R * Math.sin(a0));
            const x1 = fx(C + R * Math.cos(a1));
            const y1 = fx(C + R * Math.sin(a1));
            const isWinner = landedIndex === i;
            return (
              <path
                key={i}
                d={`M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1} Z`}
                fill={tierColor(s.mult)}
                stroke={isWinner ? '#ffffff' : '#0a0a0f'}
                strokeWidth={isWinner ? 2 : 1}
                className={isWinner ? 'animate-seg-flash' : undefined}
              />
            );
          })}
          <circle cx={C} cy={C} r={34} fill="#0a0a0f" stroke="#2A2E3C" strokeWidth={2} />
        </svg>
        {/* Hub label — shows the outcome only once the wheel has stopped */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {revealed && !spinning ? (
            <span className="flex flex-col items-center leading-tight font-mono font-bold text-foreground/80">
              <span className="text-sm">{revealed.multiplier}×</span>
              {revealed.won && (
                <span className="text-[10px] text-emerald-400">
                  +{formatSol(revealed.payoutLamports, 3)}
                </span>
              )}
            </span>
          ) : (
            <span
              className={cn(
                'font-mono text-sm font-bold',
                spinning ? 'text-foreground-muted animate-instant-shimmer' : 'text-foreground/80',
              )}
            >
              SPIN
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
