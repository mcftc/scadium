'use client';

import { cn } from '@/lib/cn';

/** Row of drawn numbers as balls; bonus ball is amber. Optionally highlight hits. */
export function LotteryBalls({
  main,
  bonus,
  hits,
  bonusHit,
  size = 'md',
}: {
  main: number[];
  bonus: number | null;
  hits?: number[];
  bonusHit?: boolean;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {main.map((n, i) => {
        const hit = hits?.includes(n);
        return (
          <span
            key={`${n}-${i}`}
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
      {bonus !== null && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full font-bold font-mono border',
            dim,
            bonusHit
              ? 'bg-amber-400 border-amber-400 text-black'
              : 'bg-amber-400/15 border-amber-400/50 text-amber-400',
          )}
        >
          {bonus}
        </span>
      )}
    </div>
  );
}
