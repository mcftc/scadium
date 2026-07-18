'use client';

import { useId, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { AUTOBET } from '@scadium/shared';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AutoBetConfig, ProgressionMode } from './use-auto-bet';

const LAMPORTS_PER_SOL = 1_000_000_000;

/** SOL string → a positive lamports threshold, or null (empty/invalid = no stop). */
function solThreshold(sol: string): bigint | null {
  const n = Number(sol);
  if (!Number.isFinite(n) || n <= 0) return null;
  return BigInt(Math.floor(n * LAMPORTS_PER_SOL));
}

/**
 * Auto-bet control block for the instant games (dice/limbo/plinko/wheel). Owns
 * the config; the panel owns the loop via `useAutoBet` and passes the live run
 * state back down. Number of bets, on-win/on-loss stake progression, and
 * stop-on-profit / stop-on-loss — the standard category set crash lacks.
 */
export function AutoBetControls({
  running,
  betsRemaining,
  sessionProfitLamports,
  currentStakeLamports,
  canStart,
  onStart,
  onStop,
}: {
  running: boolean;
  betsRemaining: number | null;
  sessionProfitLamports: bigint;
  currentStakeLamports: bigint;
  canStart: boolean;
  onStart: (cfg: AutoBetConfig) => void;
  onStop: () => void;
}) {
  const [numberOfBets, setNumberOfBets] = useState('0');
  const [onWinMode, setOnWinMode] = useState<ProgressionMode>('reset');
  const [onWinPct, setOnWinPct] = useState('100');
  const [onLossMode, setOnLossMode] = useState<ProgressionMode>('reset');
  const [onLossPct, setOnLossPct] = useState('100');
  const [stopProfit, setStopProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const nBetsId = useId();

  function handleStart() {
    const clampPct = (s: string) =>
      Math.min(AUTOBET.MAX_INCREASE_PCT, Math.max(0, Number(s) || 0));
    onStart({
      numberOfBets: Math.max(0, Math.floor(Number(numberOfBets) || 0)),
      onWin: { mode: onWinMode, pct: clampPct(onWinPct) },
      onLoss: { mode: onLossMode, pct: clampPct(onLossPct) },
      stopProfitLamports: solThreshold(stopProfit),
      stopLossLamports: solThreshold(stopLoss),
    });
  }

  const profitPositive = sessionProfitLamports >= 0n;

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor={nBetsId}
          className="mb-1.5 block text-xs uppercase tracking-wider text-foreground-muted"
        >
          Number of bets
        </label>
        <input
          id={nBetsId}
          type="number"
          min={0}
          step={1}
          value={numberOfBets}
          onChange={(e) => setNumberOfBets(e.target.value)}
          disabled={running}
          placeholder="0 = ∞"
          className="h-10 w-full rounded-xl border border-border bg-surface-elevated px-4 text-sm font-mono focus:border-primary-400 focus:outline-none disabled:opacity-50"
        />
        <p className="mt-1 text-[10px] text-foreground-muted">0 runs until you stop.</p>
      </div>

      <ProgressionRow
        label="On win"
        mode={onWinMode}
        setMode={setOnWinMode}
        pct={onWinPct}
        setPct={setOnWinPct}
        disabled={running}
      />
      <ProgressionRow
        label="On loss"
        mode={onLossMode}
        setMode={setOnLossMode}
        pct={onLossPct}
        setPct={setOnLossPct}
        disabled={running}
      />

      <div className="grid grid-cols-2 gap-2">
        <StopInput label="Stop on profit" value={stopProfit} setValue={setStopProfit} disabled={running} />
        <StopInput label="Stop on loss" value={stopLoss} setValue={setStopLoss} disabled={running} />
      </div>

      {running ? (
        <button
          type="button"
          onClick={onStop}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-danger text-sm font-bold text-white transition-colors hover:bg-danger/90"
        >
          <Square className="h-4 w-4" />
          Stop auto-bet
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-400 disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Start auto-bet
        </button>
      )}

      {running && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2 text-[11px]">
          <span className="flex items-center gap-1.5 text-foreground-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            {betsRemaining === null ? '∞ left' : `${betsRemaining} left`}
            <span className="text-foreground-muted/60">· {formatSol(currentStakeLamports.toString(), 2)}</span>
          </span>
          <span className={cn('font-mono font-semibold', profitPositive ? 'text-success' : 'text-danger')}>
            {profitPositive ? '+' : '−'}
            {formatSol((sessionProfitLamports < 0n ? -sessionProfitLamports : sessionProfitLamports).toString(), 3)}
          </span>
        </div>
      )}
    </div>
  );
}

function ProgressionRow({
  label,
  mode,
  setMode,
  pct,
  setPct,
  disabled,
}: {
  label: string;
  mode: ProgressionMode;
  setMode: (m: ProgressionMode) => void;
  pct: string;
  setPct: (v: string) => void;
  disabled: boolean;
}) {
  const pctId = useId();
  return (
    <div>
      <label
        htmlFor={pctId}
        className="mb-1.5 block text-xs uppercase tracking-wider text-foreground-muted"
      >
        {label}
      </label>
      <div className="flex gap-2">
        <div className="flex flex-1 gap-0.5 rounded-lg border border-border bg-background p-0.5">
          <button
            type="button"
            aria-pressed={mode === 'reset'}
            onClick={() => setMode('reset')}
            disabled={disabled}
            className={cn(
              'flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
              mode === 'reset' ? 'bg-surface-elevated text-foreground' : 'text-foreground-muted',
            )}
          >
            Reset
          </button>
          <button
            type="button"
            aria-pressed={mode === 'increase'}
            onClick={() => setMode('increase')}
            disabled={disabled}
            className={cn(
              'flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
              mode === 'increase' ? 'bg-surface-elevated text-foreground' : 'text-foreground-muted',
            )}
          >
            Increase
          </button>
        </div>
        <div className="relative w-24">
          <input
            id={pctId}
            type="number"
            min={0}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            disabled={disabled || mode === 'reset'}
            aria-label={`${label} — increase percent`}
            className="h-9 w-full rounded-lg border border-border bg-surface-elevated pl-3 pr-6 text-sm font-mono focus:border-primary-400 focus:outline-none disabled:opacity-40"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">
            %
          </span>
        </div>
      </div>
    </div>
  );
}

function StopInput({
  label,
  value,
  setValue,
  disabled,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[10px] uppercase tracking-wider text-foreground-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="SOL"
        className="h-9 w-full rounded-lg border border-border bg-surface-elevated px-3 text-sm font-mono focus:border-primary-400 focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}
