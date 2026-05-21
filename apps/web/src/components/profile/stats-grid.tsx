'use client';

import { TrendingUp, Coins, Trophy, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatSol } from '@/lib/format';
import { useMyStats } from '@/hooks/use-me';

/**
 * Four-KPI aggregate stats row, server-sourced from /me/stats.
 * Handles the loading state with skeleton values so the layout doesn't jump.
 */
export function StatsGrid() {
  const { data, isLoading } = useMyStats();

  const items = [
    {
      label: 'Total wagered',
      value: isLoading ? '…' : formatSol(data?.totalWageredLamports ?? '0', 3),
      icon: BarChart3,
    },
    {
      label: 'Total won',
      value: isLoading ? '…' : formatSol(data?.totalWonLamports ?? '0', 3),
      icon: Coins,
      accent: 'text-success',
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
              <div className={`mt-2 text-2xl font-bold ${item.accent ?? ''}`}>{item.value}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
