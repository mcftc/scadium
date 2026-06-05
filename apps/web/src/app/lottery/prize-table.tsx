'use client';

import { formatUsd } from '@/lib/format';
import type { LotterySnapshot } from '@/hooks/use-lottery';

// Display order: best tier first.
const TIERS: { key: string; label: string }[] = [
  { key: '5+1', label: '5 + Bonus' },
  { key: '5+0', label: '5' },
  { key: '4+1', label: '4 + Bonus' },
  { key: '4+0', label: '4' },
  { key: '3+1', label: '3 + Bonus' },
  { key: '3+0', label: '3' },
  { key: '2+1', label: '2 + Bonus' },
  { key: '2+0', label: '2' },
  { key: '1+1', label: '1 + Bonus' },
  { key: '0+1', label: 'Bonus only' },
];

/**
 * Prize tiers. The multipliers + ticket price come from the live API snapshot
 * (single source of truth lives in `@scadium/shared`, consumed server-side),
 * so the browser bundle never imports cross-package runtime values.
 */
export function PrizeTable({ snap }: { snap: LotterySnapshot | null }) {
  const prizes = snap?.config.prizes ?? {};
  const priceUsd = snap?.ticketPriceUsd ?? 0;

  return (
    <div className="space-y-1.5">
      {TIERS.map(({ key, label }) => {
        const mult = prizes[key] ?? 0;
        const payoutUsd = mult * priceUsd;
        const jackpot = key === '5+1';
        return (
          <div
            key={key}
            className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-surface-elevated/50"
          >
            <span className={jackpot ? 'font-bold text-gradient' : 'text-foreground-muted'}>
              {label}
            </span>
            <span className="flex items-center gap-2 font-mono">
              <span className={jackpot ? 'text-amber-400 font-bold' : 'text-foreground/80'}>
                {mult.toLocaleString()}×
              </span>
              <span className="text-foreground-muted/60 tabular-nums w-24 text-right">
                {formatUsd(payoutUsd)} USDT
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
