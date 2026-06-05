'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { useRecentDraws } from '@/hooks/use-lottery';
import { LotteryBalls } from './lottery-balls';

export function RecentDraws() {
  const { data, isLoading } = useRecentDraws();

  if (isLoading) {
    return <div className="py-6 text-center text-xs text-foreground-muted">Loading…</div>;
  }
  if (!data || data.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-foreground-muted">No draws yet — be first.</div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((d) => {
        const verifyHref =
          `/fairness?game=lottery&clientSeed=${encodeURIComponent(d.clientSeed)}` +
          `&nonce=${d.nonce}&commit=${d.serverSeedHash}` +
          (d.serverSeed ? `&serverSeed=${d.serverSeed}` : '');
        return (
          <div
            key={d.id}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-elevated/40"
          >
            <LotteryBalls main={d.mainNumbers} bonus={d.bonusNumber} size="sm" />
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[10px] text-foreground-muted tabular-nums">
                {d.ticketCount} tickets
              </span>
              <Link
                href={verifyHref}
                className="text-foreground-muted hover:text-primary-400 transition-colors"
                aria-label="Verify draw"
                title="Verify this draw"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
