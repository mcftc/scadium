'use client';

import { useMyLotteryTickets } from '@/hooks/use-lottery';
import { formatUsd } from '@/lib/format';
import { LotteryBalls } from './lottery-balls';
import { cn } from '@/lib/cn';

/** Caller's tickets; `onlyOpen` narrows to the current (undrawn) draw. */
export function MyTickets({ onlyOpen = false }: { onlyOpen?: boolean }) {
  const { data, isLoading } = useMyLotteryTickets();

  if (isLoading) {
    return <div className="py-6 text-center text-xs text-foreground-muted">Loading…</div>;
  }
  const tickets = (data ?? []).filter((t) => !onlyOpen || t.drawStatus === 'open');
  if (tickets.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-foreground-muted">
        No tickets yet. Pick your numbers and enter the draw.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tickets.map((t) => {
        const settled = t.drawStatus === 'drawn';
        const won = settled && t.won && t.payoutUsd > 0;
        return (
          <div
            key={t.id}
            className={cn(
              'px-3 py-2 rounded-lg border',
              !settled
                ? 'bg-surface-elevated/40 border-border'
                : won
                  ? 'bg-success/10 border-success/40'
                  : 'bg-surface-elevated/30 border-border/60',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <LotteryBalls
                main={t.mainNumbers}
                bonus={t.bonusNumber}
                hits={settled ? t.drawMain : undefined}
                bonusHit={settled && t.matchedBonus > 0}
                size="sm"
              />
              <span className="text-[10px] shrink-0">
                {!settled ? (
                  <span className="text-foreground-muted">pending</span>
                ) : won ? (
                  <span className="text-success font-semibold">
                    +{formatUsd(t.payoutUsd)} USDT
                  </span>
                ) : (
                  <span className="text-foreground-muted">no win</span>
                )}
              </span>
            </div>
            {settled && (
              <div className="mt-1 text-[10px] text-foreground-muted">
                matched {t.matchedMain} + {t.matchedBonus > 0 ? 'bonus' : 'no bonus'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
