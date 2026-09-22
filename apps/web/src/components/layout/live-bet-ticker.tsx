'use client';

import Link from 'next/link';
import { Radio } from 'lucide-react';
import { useLiveFeed, type LiveBet } from '@/hooks/use-live-feed';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';
import { gameMeta, isGameVisible } from '@/config/games';

/**
 * Sitewide live-bet ticker (#roadmap-4) — the social-proof surface every
 * category peer has and Scadium lacked. A thin horizontal strip of the most
 * recent settled bets across all 12 games, seeded from `/live/bets` and
 * live-updated over the `/live` socket. Newest enters on the left.
 */
export function LiveBetTicker() {
  const bets = useLiveFeed(24);
  if (bets.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border/50 bg-surface/40 px-3 py-1.5">
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-400">
        <Radio className="h-3 w-3 animate-pulse" />
        <span className="hidden sm:inline">Live</span>
      </span>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {bets.map((b) => (
          <TickerChip key={b.id} bet={b} />
        ))}
      </div>
    </div>
  );
}

function TickerChip({ bet }: { bet: LiveBet }) {
  // Lookup, not a menu: ALL_GAMES (via gameMeta) so a settled bet on a game
  // that's since been hidden — or long gone — still resolves a label. Only
  // a currently-visible game gets a href; a hidden one's page 404s, so its
  // chip renders as a non-clickable span with the label still shown.
  const meta = gameMeta(bet.gameType);
  const label = meta?.label ?? bet.gameType;
  const href = meta && isGameVisible(meta.id) ? meta.href : undefined;
  const mult = bet.multiplier != null && bet.won ? `${bet.multiplier.toFixed(2)}×` : null;
  const title = `${bet.player} · ${label} · ${formatSol(bet.amountLamports)}`;
  const className = cn(
    'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors',
    bet.won
      ? 'border-success/25 bg-success/5 hover:border-success/50'
      : 'border-border/60 bg-background/40 hover:border-border',
  );
  const content = (
    <>
      <span className="max-w-[72px] truncate font-medium text-foreground-muted">{bet.player}</span>
      <span className="text-foreground-muted/50">{label}</span>
      <span className="font-mono tabular-nums text-foreground-muted">
        {formatSol(bet.amountLamports, 2)}
      </span>
      {mult ? (
        <span className="font-display font-semibold tabular-nums text-success">{mult}</span>
      ) : (
        <span className="font-semibold text-danger/70">—</span>
      )}
    </>
  );

  if (!href) {
    return (
      <span title={title} className={className}>
        {content}
      </span>
    );
  }

  return (
    <Link href={href} title={title} className={className}>
      {content}
    </Link>
  );
}
