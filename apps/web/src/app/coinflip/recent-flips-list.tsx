'use client';

import { useMemo } from 'react';
import { Check, Eye, X, Swords } from 'lucide-react';
import { useRecentCoinflips, type CoinflipGame } from '@/hooks/use-coinflip';
import { formatSol, shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useMe } from '@/hooks/use-me';
import type { FlipSort } from './coinflip-lobby';

export function RecentFlipsList({
  sort,
  onWatch,
}: {
  sort: FlipSort;
  onWatch: (game: CoinflipGame) => void;
}) {
  const { data, isLoading } = useRecentCoinflips();
  const { data: me } = useMe();

  const sorted = useMemo(() => {
    const list = [...(data ?? [])];
    if (sort === 'price') {
      list.sort((a, b) => Number(BigInt(b.amountLamports) - BigInt(a.amountLamports)));
    } else {
      list.sort(
        (a, b) => Date.parse(b.resolvedAt ?? b.createdAt) - Date.parse(a.resolvedAt ?? a.createdAt),
      );
    }
    return list;
  }, [data, sort]);

  if (isLoading) {
    return <div className="py-12 text-center text-foreground-muted text-sm">Loading...</div>;
  }

  if (sorted.length === 0) {
    return (
      <div className="py-16 text-center text-foreground-muted text-sm">
        No resolved flips yet.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/30">
      {sorted.map((flip) => {
        const creatorWon = flip.winnerId === flip.creatorId;
        const iWon = me?.id != null && flip.winnerId === me.id;
        const iLost =
          me?.id != null &&
          (flip.creatorId === me.id || flip.joinerId === me.id) &&
          flip.winnerId !== me.id;

        const creatorName = flip.creatorUsername ?? shortAddress(flip.creatorWallet ?? '');
        const joinerName = flip.joinerUsername ?? shortAddress(flip.joinerWallet ?? '');

        return (
          <div
            key={flip.id}
            className={cn(
              'grid grid-cols-[1fr_110px_130px_120px] gap-4 items-center px-5 py-3 transition-colors',
              iWon
                ? 'bg-emerald-500/5'
                : iLost
                  ? 'bg-red-500/5'
                  : 'hover:bg-surface-elevated/30',
            )}
          >
            {/* Players: Creator VS Joiner */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <div
                  className={cn(
                    'h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                    creatorWon
                      ? 'bg-gradient-to-br from-emerald-400 to-emerald-700 text-white'
                      : 'bg-gradient-to-br from-red-400 to-red-700 text-white',
                  )}
                >
                  {creatorName.charAt(0).toUpperCase()}
                </div>
                <span className={cn('text-xs font-semibold truncate', creatorWon && 'text-emerald-400')}>
                  {creatorName}
                </span>
                {creatorWon ? (
                  <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                ) : (
                  <X className="h-3 w-3 text-red-400 shrink-0" />
                )}
              </div>
              <Swords className="h-3 w-3 text-foreground-muted/40 shrink-0" />
              <div className="flex items-center gap-1.5 min-w-0">
                <div
                  className={cn(
                    'h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                    !creatorWon
                      ? 'bg-gradient-to-br from-emerald-400 to-emerald-700 text-white'
                      : 'bg-gradient-to-br from-red-400 to-red-700 text-white',
                  )}
                >
                  {joinerName.charAt(0).toUpperCase()}
                </div>
                <span className={cn('text-xs font-semibold truncate', !creatorWon && 'text-emerald-400')}>
                  {joinerName}
                </span>
                {!creatorWon ? (
                  <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                ) : (
                  <X className="h-3 w-3 text-red-400 shrink-0" />
                )}
              </div>
            </div>

            {/* Result side */}
            <div className="text-center">
              <span
                className={cn(
                  'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase',
                  flip.result === 'heads'
                    ? 'bg-primary-400/15 text-primary-400 border border-primary-400/30'
                    : 'bg-cyan-400/15 text-cyan-400 border border-cyan-400/30',
                )}
              >
                {flip.result}
              </span>
            </div>

            {/* Amount */}
            <div className="text-right font-mono font-bold text-sm">
              {formatSol(flip.amountLamports, 4)}
            </div>

            {/* Payout + replay */}
            <div className="flex items-center justify-end gap-1.5">
              <span className="text-xs text-foreground-muted">1.9x</span>
              <button
                type="button"
                onClick={() => onWatch(flip)}
                aria-label="Replay this flip"
                title="Replay"
                className="rounded-lg p-1.5 text-foreground-muted hover:bg-surface-elevated hover:text-foreground transition-colors"
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
