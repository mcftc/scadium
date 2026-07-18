'use client';

import { cn } from '@/lib/cn';

export type BetMode = 'manual' | 'auto';

/** Manual / Auto selector shared across the instant game bet panels. */
export function BetModeTabs({
  mode,
  setMode,
  disabled,
}: {
  mode: BetMode;
  setMode: (m: BetMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Bet mode"
      className="grid grid-cols-2 gap-0.5 rounded-xl border border-border bg-background p-1"
    >
      {(['manual', 'auto'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          onClick={() => setMode(m)}
          disabled={disabled}
          className={cn(
            'rounded-lg py-2 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50',
            mode === m ? 'bg-surface-elevated text-foreground' : 'text-foreground-muted hover:text-foreground',
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
