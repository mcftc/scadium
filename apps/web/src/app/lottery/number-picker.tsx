'use client';

import { cn } from '@/lib/cn';

/**
 * Grid number selector. Players pick exactly `mainCount` numbers from
 * 1..mainMax and one bonus from 1..bonusMax. Pure controlled component — the
 * parent owns selection state.
 */
export function NumberPicker({
  mainMax,
  mainCount,
  bonusMax,
  main,
  bonus,
  onToggleMain,
  onPickBonus,
  disabled,
}: {
  mainMax: number;
  mainCount: number;
  bonusMax: number;
  main: number[];
  bonus: number | null;
  onToggleMain: (n: number) => void;
  onPickBonus: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-wider text-foreground-muted">
            Pick {mainCount} numbers
          </span>
          <span className="text-xs font-mono text-foreground-muted">
            {main.length}/{mainCount}
          </span>
        </div>
        <div className="grid grid-cols-9 gap-1.5">
          {Array.from({ length: mainMax }, (_, i) => i + 1).map((n) => {
            const selected = main.includes(n);
            const full = main.length >= mainCount && !selected;
            return (
              <button
                key={n}
                type="button"
                disabled={disabled || full}
                onClick={() => onToggleMain(n)}
                className={cn(
                  'aspect-square rounded-lg text-xs font-bold font-mono transition-all',
                  selected
                    ? 'bg-gradient-primary text-white shadow-lg shadow-primary-400/30 scale-105'
                    : full
                      ? 'bg-surface-elevated/40 text-foreground-muted/30 cursor-not-allowed'
                      : 'bg-surface-elevated text-foreground-muted hover:text-foreground hover:bg-surface-elevated/80 hover:ring-1 hover:ring-primary-400/40',
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-wider text-foreground-muted">
            Bonus number
          </span>
          <span className="text-xs font-mono text-foreground-muted">{bonus ? '1/1' : '0/1'}</span>
        </div>
        <div className="grid grid-cols-10 gap-1.5">
          {Array.from({ length: bonusMax }, (_, i) => i + 1).map((n) => {
            const selected = bonus === n;
            return (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => onPickBonus(n)}
                className={cn(
                  'aspect-square rounded-lg text-xs font-bold font-mono transition-all',
                  selected
                    ? 'bg-amber-400 text-black shadow-lg shadow-amber-400/30 scale-105'
                    : 'bg-surface-elevated text-foreground-muted hover:text-foreground hover:ring-1 hover:ring-amber-400/40',
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
