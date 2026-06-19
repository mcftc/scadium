'use client';

import { cn } from '@/lib/cn';

const PRESETS = ['0.1', '0.5', '1', '5'];
const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Shared bet-amount control for the instant games — mirrors the crash bet panel
 * (½ / ×2 / MAX inside the input + preset row). Value is the SOL string; the
 * parent converts to lamports for the API. MAX/×2 clamp to the game's MAX bet.
 */
export function BetAmountInput({
  sol,
  setSol,
  minLamports,
  maxLamports,
  disabled,
}: {
  sol: string;
  setSol: (v: string) => void;
  minLamports: number;
  maxLamports: number;
  disabled?: boolean;
}) {
  const minSol = minLamports / LAMPORTS_PER_SOL;
  const maxSol = maxLamports / LAMPORTS_PER_SOL;
  const clamp = (n: number) => Math.min(maxSol, Math.max(minSol, n));

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
        Bet amount (SOL)
      </div>
      <div className="relative">
        <input
          type="number"
          step="0.001"
          min={minSol}
          value={sol}
          onChange={(e) => setSol(e.target.value)}
          disabled={disabled}
          className="w-full rounded-xl border border-border bg-surface-elevated pl-4 pr-28 h-11 text-sm font-mono focus:outline-none focus:border-primary-400 disabled:opacity-50"
        />
        <div className="absolute right-1 top-1 bottom-1 flex gap-0.5">
          <button
            type="button"
            onClick={() => setSol(String(clamp(Number(sol) / 2)))}
            disabled={disabled}
            className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            ½
          </button>
          <button
            type="button"
            onClick={() => setSol(String(clamp(Number(sol) * 2)))}
            disabled={disabled}
            className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            ×2
          </button>
          <button
            type="button"
            onClick={() => setSol(String(clamp(maxSol)))}
            disabled={disabled}
            className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            MAX
          </button>
        </div>
      </div>
      <div className="mt-2 flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setSol(p)}
            disabled={disabled}
            className={cn(
              'flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50',
              sol === p
                ? 'border-primary-400/50 bg-primary-400/10 text-primary-400'
                : 'border-border text-foreground-muted hover:border-primary-400/30',
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

/** SOL string → lamports string, clamped to the game's MIN/MAX. */
export function solToLamportsClamped(sol: string, minLamports: number, maxLamports: number): string {
  const raw = Math.floor(Number(sol) * LAMPORTS_PER_SOL);
  if (!Number.isFinite(raw)) return String(minLamports);
  return String(Math.min(maxLamports, Math.max(minLamports, raw)));
}
