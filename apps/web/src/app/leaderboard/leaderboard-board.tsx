'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Crown, Medal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { formatSol, shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Entry {
  rank: number;
  userId: string;
  username: string | null;
  walletAddress: string;
  volumeLamports: string;
  /** All-time board only; windowed boards rank by volume. */
  profitLamports?: string;
  gamesPlayed?: number;
}

type Period = 'all' | 'daily' | 'weekly';
type Metric = 'volume' | 'profit';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All-time' },
  { key: 'daily', label: 'Today' },
  { key: 'weekly', label: 'This week' },
];

export function LeaderboardBoard() {
  const [period, setPeriod] = useState<Period>('all');
  const [metric, setMetric] = useState<Metric>('volume');
  // Windowed boards rank by wagered volume only; the metric toggle applies to all-time.
  const effectiveMetric: Metric = period === 'all' ? metric : 'volume';

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', period, effectiveMetric],
    queryFn: () =>
      period === 'all'
        ? api<Entry[]>(`/leaderboard/${effectiveMetric}?limit=50`)
        : api<Entry[]>(`/leaderboard/window?period=${period}&limit=50`),
    refetchInterval: 15_000,
  });

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Top players</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border bg-background p-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  period === p.key
                    ? 'bg-surface-elevated text-foreground'
                    : 'text-foreground-muted',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === 'all' && (
            <div className="flex gap-1 rounded-lg border border-border bg-background p-1">
              {(['volume', 'profit'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetric(m)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                    metric === m ? 'bg-surface-elevated text-foreground' : 'text-foreground-muted',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-16 text-center text-foreground-muted text-sm">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="py-16 text-center text-foreground-muted text-sm">
            No players on the board {period === 'all' ? 'yet' : 'for this window yet'}.
          </div>
        ) : (
          <div>
            {data.map((e) => (
              <Row key={e.userId} entry={e} metric={effectiveMetric} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ entry, metric }: { entry: Entry; metric: Metric }) {
  const isTop3 = entry.rank <= 3;
  const Icon = entry.rank === 1 ? Crown : entry.rank === 2 ? Trophy : Medal;
  const value = metric === 'profit' ? (entry.profitLamports ?? '0') : entry.volumeLamports;
  return (
    <div
      className={cn(
        'flex items-center gap-4 px-6 py-4 border-b border-border/30 last:border-0',
        isTop3 && 'bg-gradient-to-r from-primary-400/5 to-transparent',
      )}
    >
      <div
        className={cn(
          'h-10 w-10 rounded-xl flex items-center justify-center font-bold text-sm',
          entry.rank === 1
            ? 'bg-gradient-to-br from-yellow-400 to-amber-600 text-white'
            : entry.rank === 2
              ? 'bg-gradient-to-br from-gray-300 to-gray-500 text-white'
              : entry.rank === 3
                ? 'bg-gradient-to-br from-amber-600 to-amber-800 text-white'
                : 'bg-surface-elevated border border-border text-foreground-muted',
        )}
      >
        {isTop3 ? <Icon className="h-5 w-5" /> : entry.rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">
          {entry.username ?? shortAddress(entry.walletAddress)}
        </div>
        {entry.gamesPlayed !== undefined && (
          <div className="text-xs text-foreground-muted">{entry.gamesPlayed} games</div>
        )}
      </div>
      <div className="text-right">
        <div className="font-bold font-mono">{formatSol(value, 3)}</div>
        <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
          {metric === 'volume' ? 'wagered' : 'profit'}
        </div>
      </div>
    </div>
  );
}
