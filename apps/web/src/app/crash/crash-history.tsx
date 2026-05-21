'use client';

import { cn } from '@/lib/cn';

export function CrashHistory({
  history,
}: {
  history: { bustPoint: number; roundId: string }[];
}) {
  if (history.length === 0) {
    return null;
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {history.slice(0, 20).map((h) => {
        const big = h.bustPoint >= 2;
        const huge = h.bustPoint >= 10;
        return (
          <div
            key={h.roundId}
            className={cn(
              'shrink-0 px-3 py-1 rounded-lg text-xs font-bold font-mono border',
              huge
                ? 'bg-primary-400/20 border-primary-400/50 text-primary-400'
                : big
                  ? 'bg-success/10 border-success/30 text-success'
                  : h.bustPoint < 1.5
                    ? 'bg-danger/10 border-danger/30 text-danger'
                    : 'bg-surface-elevated border-border text-foreground-muted',
            )}
          >
            {h.bustPoint.toFixed(2)}×
          </div>
        );
      })}
    </div>
  );
}
