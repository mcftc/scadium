'use client';

import { formatUsd } from '@/lib/format';
import type { LotterySnapshot } from '@/hooks/use-lottery';

/**
 * bc.game-style fixed-prize tiers, paid in USDT. The bonus number only
 * matters for the grand prize; 4 or 3 main matches pay regardless of bonus;
 * matching NOTHING wins a free ticket in the next draw. Values come from
 * the live API snapshot (no cross-package runtime imports in the bundle).
 */
export function PrizeTable({ snap }: { snap: LotterySnapshot | null }) {
  const p = snap?.config.prizesUsd;
  const rows: { label: string; value: string; grand?: boolean; free?: boolean }[] = [
    { label: '5 + Bonus — Grand Prize', value: p ? `${formatUsd(p.grand)} USDT` : '—', grand: true },
    { label: '5 main numbers', value: p ? `${formatUsd(p.second)} USDT` : '—' },
    { label: '4 main numbers', value: p ? `${formatUsd(p.third)} USDT` : '—' },
    { label: '3 main numbers', value: p ? `${formatUsd(p.fourth)} USDT` : '—' },
    { label: 'No matches at all', value: 'Free ticket → next draw', free: true },
  ];

  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-surface-elevated/50"
        >
          <span className={r.grand ? 'font-bold text-gradient' : 'text-foreground-muted'}>
            {r.label}
          </span>
          <span
            className={
              r.grand
                ? 'font-mono text-amber-400 font-bold'
                : r.free
                  ? 'text-primary-300 text-[11px] font-semibold'
                  : 'font-mono text-foreground/80'
            }
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
