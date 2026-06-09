'use client';

import { cn } from '@/lib/cn';

/**
 * Row of a ticket / winning number's 6 digits as balls. `matchLen` highlights
 * the leading matched prefix (left-to-right, PancakeSwap matching) in success
 * color — pass it on a ticket row to show how far it matched the draw.
 */
export function LotteryBalls({
  digits,
  matchLen = 0,
  size = 'md',
}: {
  digits: number[];
  matchLen?: number;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {digits.map((n, i) => {
        const hit = i < matchLen;
        return (
          <span
            key={`${i}-${n}`}
            className={cn(
              'inline-flex items-center justify-center rounded-full font-bold font-mono border',
              dim,
              hit
                ? 'bg-success/20 border-success text-success'
                : 'bg-surface-elevated border-border text-foreground/90',
            )}
          >
            {n}
          </span>
        );
      })}
    </div>
  );
}
