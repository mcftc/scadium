'use client';

import { Crown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { formatUsd } from '@/lib/format';
import { useJackpotWinners } from '@/hooks/use-lottery';
import { LotteryBalls } from './lottery-balls';
import { PlayerCell } from './player-cell';

/** bc.game Jackpot Winners tab: historical grand-prize winners. */
export function JackpotWinnersTab() {
  const { data, isLoading } = useJackpotWinners();

  if (isLoading) {
    return <div className="py-10 text-center text-xs text-foreground-muted">Loading…</div>;
  }
  if (!data || data.length === 0) {
    return (
      <Card className="p-10 text-center space-y-2">
        <Crown className="mx-auto h-8 w-8 text-amber-400/60" />
        <p className="text-sm font-semibold">No grand-prize winners yet</p>
        <p className="text-xs text-foreground-muted">
          Be the first to match 5 numbers + the Jackpot Ball and take the{' '}
          <span className="text-success font-semibold">$100,000</span> grand prize.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="space-y-1">
        <div className="hidden sm:grid grid-cols-[130px_1fr_auto_70px_110px] gap-3 px-3 pb-2 text-[10px] uppercase tracking-wider text-foreground-muted">
          <span>Game number</span>
          <span>Top Winner</span>
          <span>Numbers</span>
          <span className="text-center">Matches</span>
          <span className="text-right">Prize</span>
        </div>
        {data.map((w, i) => (
          <div
            key={i}
            className="grid sm:grid-cols-[130px_1fr_auto_70px_110px] grid-cols-1 gap-2 sm:gap-3 items-center rounded-lg bg-surface-elevated/40 px-3 py-2"
          >
            <span className="text-xs font-mono text-foreground-muted">{w.gameNumber}</span>
            <PlayerCell player={w.player} />
            <LotteryBalls main={w.mainNumbers} bonus={w.bonusNumber} size="sm" />
            <span className="text-xs font-mono sm:text-center">
              {w.matchedMain + w.matchedBonus}
            </span>
            <span className="text-xs font-mono font-bold text-success sm:text-right">
              {formatUsd(w.payoutUsd)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
