'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * PancakeSwap-style 6-digit picker. A ticket is 6 digits (each 0..9), matched
 * left-to-right. Tap a position tile to make it active, then tap a digit on the
 * 0-9 keypad to set it (auto-advances to the next position). Pure controlled
 * component — the parent owns the digits array.
 */
export function NumberPicker({
  digits,
  onSetDigit,
  disabled,
}: {
  digits: number[]; // length 6, each 0..9
  onSetDigit: (index: number, digit: number) => void;
  disabled?: boolean;
}) {
  const [active, setActive] = useState(0);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-wider text-foreground-muted">
            Your 6-digit number
          </span>
          <span className="text-xs font-mono text-foreground-muted">matched left → right</span>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: 6 }, (_, i) => {
            const d = digits[i] ?? 0;
            const isActive = i === active;
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={() => setActive(i)}
                className={cn(
                  'aspect-square rounded-lg text-base font-bold font-mono transition-all',
                  isActive
                    ? 'bg-gradient-primary text-white shadow-lg shadow-primary-400/30 scale-105 ring-2 ring-primary-400/60'
                    : 'bg-surface-elevated text-foreground hover:text-foreground hover:bg-surface-elevated/80 hover:ring-1 hover:ring-primary-400/40',
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs uppercase tracking-wider text-foreground-muted">
            Set position {active + 1}
          </span>
          <span className="text-xs font-mono text-foreground-muted">0–9</span>
        </div>
        <div className="grid grid-cols-10 gap-1.5">
          {Array.from({ length: 10 }, (_, n) => {
            const selected = (digits[active] ?? 0) === n;
            return (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSetDigit(active, n);
                  setActive((a) => Math.min(5, a + 1));
                }}
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
