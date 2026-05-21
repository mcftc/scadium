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
  profitLamports: string;
  gamesPlayed: number;
}

export function LeaderboardBoard() {
  const [tab, setTab] = useState<'volume' | 'profit'>('volume');
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', tab],
    queryFn: () => api<Entry[]>(`/leaderboard/${tab}?limit=50`),
    refetchInterval: 15_000,
  });

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Top players</CardTitle>
        <div className="flex gap-1 p-1 bg-background rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setTab('volume')}
            className={cn(
              'px-4 py-1.5 text-xs font-semibold rounded-md transition-colors',
              tab === 'volume'
                ? 'bg-surface-elevated text-foreground'
                : 'text-foreground-muted',
            )}
          >
            By volume
          </button>
          <button
            type="button"
            onClick={() => setTab('profit')}
            className={cn(
              'px-4 py-1.5 text-xs font-semibold rounded-md transition-colors',
              tab === 'profit'
                ? 'bg-surface-elevated text-foreground'
                : 'text-foreground-muted',
            )}
          >
            By profit
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-16 text-center text-foreground-muted text-sm">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="py-16 text-center text-foreground-muted text-sm">
            No players on the board yet.
          </div>
        ) : (
          <div>
            {data.map((e) => (
              <Row key={e.userId} entry={e} metric={tab} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ entry, metric }: { entry: Entry; metric: 'volume' | 'profit' }) {
  const isTop3 = entry.rank <= 3;
  const Icon = entry.rank === 1 ? Crown : entry.rank === 2 ? Trophy : Medal;
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
        <div className="text-xs text-foreground-muted">{entry.gamesPlayed} games</div>
      </div>
      <div className="text-right">
        <div className="font-bold font-mono">
          {formatSol(metric === 'volume' ? entry.volumeLamports : entry.profitLamports, 3)}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
          {metric === 'volume' ? 'wagered' : 'profit'}
        </div>
      </div>
    </div>
  );
}
