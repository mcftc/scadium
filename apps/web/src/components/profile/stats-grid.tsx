'use client';

import { useState } from 'react';
import { BarChart3, Coins, RotateCcw, TrendingUp, Trophy } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useMyStats, useResetStats, type StatsWindow } from '@/hooks/use-me';

const WINDOWS: [StatsWindow, string][] = [
  ['24h', '24H'],
  ['7d', '7D'],
  ['1m', '1M'],
  ['all', 'All'],
];

/**
 * Windowed aggregate stats (solpump parity): 24H/7D/1M/ALL toggle, four KPIs
 * (wager / net profit / biggest win / games), and a Reset Stats action that
 * rebaselines the lifetime totals from now on.
 */
export function StatsGrid() {
  const [window, setWindow] = useState<StatsWindow>('all');
  const { data, isLoading } = useMyStats(window);
  const reset = useResetStats();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const net = data ? BigInt(data.netLamports) : BigInt(0);
  const items = [
    {
      label: 'Wagered',
      value: isLoading ? '…' : formatSol(data?.totalWageredLamports ?? '0', 3),
      icon: BarChart3,
    },
    {
      label: 'Net profit',
      value: isLoading
        ? '…'
        : `${net > BigInt(0) ? '+' : ''}${formatSol(data?.netLamports ?? '0', 3)}`,
      icon: Coins,
      accent: net > BigInt(0) ? 'text-success' : net < BigInt(0) ? 'text-danger' : undefined,
    },
    {
      label: 'Biggest win',
      value: isLoading ? '…' : formatSol(data?.biggestWinLamports ?? '0', 3),
      icon: Trophy,
    },
    {
      label: 'Games played',
      value: isLoading ? '…' : (data?.gamesPlayed ?? 0).toString(),
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 p-1 bg-background rounded-lg border border-border">
          {WINDOWS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setWindow(key)}
              className={cn(
                'px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors',
                window === key
                  ? 'bg-surface-elevated text-foreground'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset stats
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-foreground-muted">
                    {item.label}
                  </span>
                  <Icon className="h-4 w-4 text-primary-400" />
                </div>
                <div className={cn('mt-2 text-2xl font-bold', item.accent)}>{item.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Reset stats?"
        description="Your lifetime totals will count only bets from this point forward. Bet history and balances are untouched."
      >
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={reset.isPending}
            onClick={() => reset.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })}
          >
            {reset.isPending ? 'Resetting…' : 'Reset stats'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
