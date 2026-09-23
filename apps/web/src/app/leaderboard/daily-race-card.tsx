'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flame, Timer, Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { useMe } from '@/hooks/use-me';
import { formatSol, shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';

interface RaceEntry {
  rank: number;
  userId: string;
  username: string | null;
  walletAddress: string;
  volumeLamports: string;
  prizeLamports: string;
}

interface RaceResponse {
  resetAt: number;
  poolLamports: string;
  prizeRanks: number;
  entries: RaceEntry[];
}

/** HH:MM:SS from a millisecond duration. */
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/**
 * Daily race (#roadmap-5): today's top wagerers split a fixed play-money prize
 * pool, paid when the UTC day completes. Live standings + a countdown to the
 * reset, so the board doubles as a retention loop alongside the live-bet feed.
 */
export function DailyRaceCard() {
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', 'race'],
    queryFn: () => api<RaceResponse>('/leaderboard/race?limit=20'),
    refetchInterval: 20_000,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const mine = me ? data?.entries.find((e) => e.userId === me.id) : undefined;
  const paid = data?.prizeRanks ?? 0;

  return (
    <Card className="max-w-3xl mx-auto overflow-hidden border-primary-400/30">
      <CardHeader className="flex flex-row items-center justify-between gap-4 bg-gradient-to-r from-primary-500/10 to-transparent">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-400" />
            Daily Race
          </CardTitle>
          <p className="mt-1 text-xs text-foreground-muted">
            Top wagerers today split the pool. Resets at 00:00 UTC.
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold tabular-nums text-gradient">
            {data ? formatSol(data.poolLamports, 0) : '—'}
          </div>
          <div className="flex items-center justify-end gap-1 text-[11px] font-semibold tabular-nums text-foreground-muted">
            <Timer className="h-3 w-3" />
            {data ? fmtDuration(data.resetAt - now) : '—'}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-foreground-muted">Loading…</div>
        ) : !data || data.entries.length === 0 ? (
          <div className="py-12 text-center text-sm text-foreground-muted">
            No wagers yet today — place a bet to enter the race.
          </div>
        ) : (
          <>
            {mine && mine.rank > 3 && (
              <div className="border-b border-border/40 bg-surface/50 px-6 py-2.5 text-xs">
                <span className="text-foreground-muted">Your position: </span>
                <span className="font-bold text-foreground">#{mine.rank}</span>
                <span className="text-foreground-muted">
                  {' '}
                  · {formatSol(mine.volumeLamports, 2)} wagered
                </span>
                {BigInt(mine.prizeLamports) > 0n && (
                  <span className="text-success">
                    {' '}
                    · in the prizes ({formatSol(mine.prizeLamports, 2)})
                  </span>
                )}
              </div>
            )}
            <div>
              {data.entries.map((e) => (
                <RaceRow
                  key={e.userId}
                  entry={e}
                  paid={e.rank <= paid}
                  isMe={e.userId === me?.id}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RaceRow({ entry, paid, isMe }: { entry: RaceEntry; paid: boolean; isMe: boolean }) {
  const prize = BigInt(entry.prizeLamports);
  return (
    <div
      className={cn(
        'flex items-center gap-4 border-b border-border/30 px-6 py-3 last:border-0',
        paid && 'bg-gradient-to-r from-primary-400/5 to-transparent',
        isMe && 'ring-1 ring-inset ring-primary-400/40',
      )}
    >
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
          entry.rank === 1
            ? 'bg-gradient-to-br from-yellow-400 to-amber-600 text-white'
            : entry.rank === 2
              ? 'bg-gradient-to-br from-gray-300 to-gray-500 text-white'
              : entry.rank === 3
                ? 'bg-gradient-to-br from-amber-600 to-amber-800 text-white'
                : 'border border-border bg-surface-elevated text-foreground-muted',
        )}
      >
        {entry.rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">
          {entry.username ?? shortAddress(entry.walletAddress)}
          {isMe && <span className="ml-1.5 text-[10px] uppercase text-primary-400">you</span>}
        </div>
        <div className="text-xs text-foreground-muted">
          {formatSol(entry.volumeLamports, 2)} wagered
        </div>
      </div>
      <div className="text-right">
        {prize > 0n ? (
          <div className="flex items-center gap-1 font-bold font-mono text-success">
            <Trophy className="h-3.5 w-3.5" />
            {formatSol(entry.prizeLamports, 2)}
          </div>
        ) : (
          <div className="text-xs text-foreground-muted">—</div>
        )}
      </div>
    </div>
  );
}
