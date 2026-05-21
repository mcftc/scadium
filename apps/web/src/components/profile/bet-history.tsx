'use client';

import { ExternalLink, TrendingUp, Coins, Spade } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMyBets, type BetRow } from '@/hooks/use-me';
import { formatSol, formatDate, formatMultiplier } from '@/lib/format';
import { env } from '@/config/env';
import { cn } from '@/lib/cn';

const gameIcon = {
  crash: TrendingUp,
  coinflip: Coins,
  blackjack: Spade,
} as const;

/**
 * Bet history table rendered from /me/bets. Cursor pagination hook is
 * wired but we only show the first page in phase 3 — pagination UI lands
 * when volumes warrant it.
 */
export function BetHistory() {
  const { data, isLoading, error } = useMyBets(20);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bet history</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && (
          <div className="p-12 text-center text-foreground-muted text-sm">Loading…</div>
        )}
        {error && (
          <div className="p-12 text-center text-danger text-sm">
            Failed to load bet history
          </div>
        )}
        {!isLoading && !error && (data?.items.length ?? 0) === 0 && (
          <div className="p-16 text-center text-foreground-muted text-sm">
            No bets yet. Try your first{' '}
            <a href="/coinflip" className="text-primary-400 hover:underline">
              coinflip
            </a>
            .
          </div>
        )}
        {!isLoading && !error && (data?.items.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-foreground-muted">
                  <th className="text-left font-medium px-6 py-3">Game</th>
                  <th className="text-right font-medium px-6 py-3">Wager</th>
                  <th className="text-right font-medium px-6 py-3">Multiplier</th>
                  <th className="text-right font-medium px-6 py-3">Payout</th>
                  <th className="text-right font-medium px-6 py-3">Date</th>
                  <th className="text-right font-medium px-6 py-3">Tx</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((bet) => (
                  <BetRowCell key={bet.id} bet={bet} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BetRowCell({ bet }: { bet: BetRow }) {
  const Icon = gameIcon[bet.gameType];
  const won = bet.status === 'won';
  const statusColor =
    bet.status === 'won'
      ? 'text-success'
      : bet.status === 'lost'
        ? 'text-danger'
        : 'text-foreground-muted';

  return (
    <tr className="border-b border-border/30 hover:bg-surface-elevated/50 transition-colors">
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
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
      <td className="px-6 py-4 text-right">
        {bet.txSignature ? (
          <a
            href={`https://solscan.io/tx/${bet.txSignature}?cluster=${env.solanaNetwork}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary-400 hover:underline text-xs"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-foreground-muted text-xs">—</span>
        )}
      </td>
    </tr>
  );
}
