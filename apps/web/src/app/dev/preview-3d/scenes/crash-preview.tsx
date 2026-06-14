'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CrashCurve } from '@/app/crash/crash-curve';
import type { CrashCashoutMarker, CrashSnapshot } from '@/hooks/use-crash';

const NAMES = ['degenking', 'moonshot', 'lucky_luc', '7kJy…7USS', 'bonkbonk', 'satoshi', 'apeAndy'];
let cid = 0;

export function CrashPreview() {
  const [phase, setPhase] = useState<CrashSnapshot['phase']>('waiting');
  const [multiplier, setMultiplier] = useState(1);
  const [roundId, setRoundId] = useState(0);
  const [cashouts, setCashouts] = useState<CrashCashoutMarker[]>([]);
  const [auto, setAuto] = useState(true);

  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mult = useRef(1);
  const bustAt = useRef(2);

  const clearAll = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const fireCashout = useCallback((atMult: number) => {
    const stake = 0.05 + Math.random() * 0.4;
    const name = NAMES[Math.floor(Math.random() * NAMES.length)] ?? 'degen';
    const payoutLamports = String(Math.round(stake * atMult * 1e9));
    setCashouts((cur) => [
      ...cur.slice(-23),
      { userId: `u${cid++}`, name, multiplier: atMult, payoutLamports },
    ]);
  }, []);

  const startRound = useCallback(() => {
    clearAll();
    mult.current = 1;
    bustAt.current = 2.4 + Math.random() * Math.random() * 16;
    setMultiplier(1);
    setCashouts([]);
    setRoundId((r) => r + 1);
    setPhase('running');

    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      timers.current.push(
        setTimeout(() => {
          if (mult.current < bustAt.current) fireCashout(Number(mult.current.toFixed(2)));
        }, 600 + Math.random() * 4000),
      );
    }

    tick.current = setInterval(() => {
      mult.current *= 1.016;
      if (mult.current >= bustAt.current) {
        setMultiplier(bustAt.current);
        setPhase('busted');
        clearAll();
        timers.current.push(setTimeout(() => setPhase('waiting'), 2600));
      } else {
        setMultiplier(mult.current);
      }
    }, 80);
  }, [fireCashout]);

  useEffect(() => {
    if (auto && phase === 'waiting') {
      const t = setTimeout(startRound, 1400);
      return () => clearTimeout(t);
    }
  }, [auto, phase, startRound]);

  useEffect(() => () => clearAll(), []);

  const snapshot: CrashSnapshot = {
    roundId: String(roundId),
    phase,
    startedAt: Date.now(),
    serverSeedHash: '0'.repeat(64),
    clientSeed: 'preview',
    nonce: 0,
    serverSeed: phase === 'busted' ? '0'.repeat(64) : null,
    bustPoint: phase === 'busted' ? multiplier : null,
    multiplier,
    bets: [],
    history: [],
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#080818]">
          <CrashCurve state={snapshot} cashouts={cashouts} myBet={null} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={startRound}
          className="rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow-sm"
        >
          Launch round
        </button>
        <button
          type="button"
          onClick={() => fireCashout(Number(multiplier.toFixed(2)))}
          disabled={phase !== 'running'}
          className="rounded-lg border border-border bg-surface-elevated px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
        >
          Cash out 🪂 (now)
        </button>
        <button
          type="button"
          onClick={() => {
            clearAll();
            setMultiplier(mult.current);
            setPhase('busted');
            timers.current.push(setTimeout(() => setPhase('waiting'), 2600));
          }}
          disabled={phase !== 'running'}
          className="rounded-lg border border-border bg-surface-elevated px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
        >
          Bust now
        </button>
        <span className="font-mono text-sm text-foreground-muted">
          {multiplier.toFixed(2)}x · {phase}
        </span>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto-loop
        </label>
      </div>
    </div>
  );
}
