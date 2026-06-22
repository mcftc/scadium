'use client';

import { History } from 'lucide-react';
import { useBets } from '@/hooks/use-bets';
import type { BetGameType } from '@/hooks/use-me';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Per-game "Recent rounds" panel: the player's last few results for this game
 * (newest first) — multiplier, stake, payout and won/lost. Shared by the
 * stateful game pages. Invalidate `['bets', game]` after a settle to refresh.
 */
export function RecentRounds({ game }: { game: BetGameType }) {
  const { data, isLoading } = useBets(game, 8);
  const rows = data?.items ?? [];

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
        <History className="h-3.5 w-3.5 text-primary-400" />
        Recent rounds
      </h3>

      {isLoading ? (
        <p className="py-3 text-center text-xs text-foreground-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-foreground-muted">
          No rounds yet — play one to see it here.
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((b) => {
            const won = b.status === 'won';
            const net = BigInt(b.payoutLamports) - BigInt(b.amountLamports);
            return (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-lg bg-surface-elevated/40 px-3 py-1.5 text-xs"
              >
                <span className="font-mono text-foreground-muted">
                  {b.multiplier != null ? `${b.multiplier.toFixed(2)}×` : '—'}
                </span>
                <span className="font-mono text-foreground-muted">
                  {formatSol(b.amountLamports, 3)}
                </span>
                <span className={cn('font-mono font-semibold', won ? 'text-success' : 'text-danger')}>
                  {won ? '+' : '−'}
                  {formatSol((net < 0n ? -net : net).toString(), 3)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
