'use client';

import { useState } from 'react';
import { ChevronDown, TrendingUp, Coins, Spade, Ticket, Trophy, CircleHelp } from 'lucide-react';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useMyBets, type BetRow, type BetGameType } from '@/hooks/use-me';
import { formatSol, formatDate, formatMultiplier } from '@/lib/format';
import { cn } from '@/lib/cn';
import { BetDetail } from './bet-detail';

const gameIcon: Record<string, typeof TrendingUp> = {
  crash: TrendingUp,
  coinflip: Coins,
  blackjack: Spade,
  lottery: Ticket,
  jackpot: Trophy,
};

const FILTERS: [BetGameType | 'all', string][] = [
  ['all', 'All'],
  ['crash', 'Crash'],
  ['coinflip', 'Coinflip'],
  ['blackjack', 'Blackjack'],
  ['jackpot', 'Jackpot'],
  ['lottery', 'Lottery'],
];

/**
 * Transactions table (solpump parity): game-type filter chips, click-to-expand
 * rows that reveal the per-game result + Solscan settlement tx + provably-fair
 * verify deep-link, and cursor "Load more" pagination.
 */
export function BetHistory() {
  const [filter, setFilter] = useState<BetGameType | 'all'>('all');
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useMyBets(
    filter === 'all' ? undefined : filter,
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-3">
        <CardTitle>Transactions</CardTitle>
        <div className="flex flex-wrap gap-1 p-1 bg-background rounded-lg border border-border">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
                filter === key
                  ? 'bg-surface-elevated text-foreground'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <CardContent className="p-0">
        {isLoading && (
          <div className="p-12 text-center text-foreground-muted text-sm">Loading…</div>
        )}
        {error && (
          <div className="p-12 text-center text-danger text-sm">Failed to load transactions</div>
        )}
        {!isLoading && !error && items.length === 0 && (
          <div className="p-16 text-center text-foreground-muted text-sm">
            No bets yet. Try your first{' '}
            <a href="/coinflip" className="text-primary-400 hover:underline">
              coinflip
            </a>
            .
          </div>
        )}
        {!isLoading && !error && items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-foreground-muted">
                    <th className="text-left font-medium px-6 py-3">Game</th>
                    <th className="text-right font-medium px-6 py-3">Wager</th>
                    <th className="text-right font-medium px-6 py-3">Multiplier</th>
                    <th className="text-right font-medium px-6 py-3">Payout</th>
                    <th className="text-right font-medium px-6 py-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((bet) => (
                    <BetRowCell key={bet.id} bet={bet} />
                  ))}
                </tbody>
              </table>
            </div>
            {hasNextPage && (
              <div className="p-4 text-center border-t border-border">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BetRowCell({ bet }: { bet: BetRow }) {
  const [open, setOpen] = useState(false);
  const Icon = gameIcon[bet.gameType] ?? CircleHelp;
  const won = bet.status === 'won';
  const statusColor =
    bet.status === 'won'
      ? 'text-success'
      : bet.status === 'lost'
        ? 'text-danger'
        : 'text-foreground-muted';

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="border-b border-border/30 hover:bg-surface-elevated/50 transition-colors cursor-pointer"
      >
        <td className="px-6 py-4">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-foreground-muted transition-transform',
                open && 'rotate-180',
              )}
            />
            <Icon className="h-4 w-4 text-primary-400" />
            <span className="capitalize font-medium">{bet.gameType}</span>
          </div>
        </td>
        <td className="px-6 py-4 text-right font-mono">{formatSol(bet.amountLamports, 3)}</td>
        <td className={cn('px-6 py-4 text-right font-mono', statusColor)}>
          {formatMultiplier(bet.multiplier)}
        </td>
        <td className={cn('px-6 py-4 text-right font-mono font-semibold', statusColor)}>
          {won ? '+' : ''}
          {formatSol(bet.payoutLamports, 3)}
        </td>
        <td className="px-6 py-4 text-right text-foreground-muted text-xs">
          {formatDate(bet.createdAt)}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/30 bg-surface-elevated/30">
          <td colSpan={5} className="p-0">
            <BetDetail bet={bet} />
          </td>
        </tr>
      )}
    </>
  );
}
