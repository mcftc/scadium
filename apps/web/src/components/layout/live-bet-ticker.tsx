'use client';

import Link from 'next/link';
import { Radio } from 'lucide-react';
import { useLiveFeed, type LiveBet } from '@/hooks/use-live-feed';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Route each game to its page so a ticker chip is clickable. */
const GAME_META: Record<string, { label: string; href: string }> = {
  crash: { label: 'Crash', href: '/crash' },
  coinflip: { label: 'Coinflip', href: '/coinflip' },
  dice: { label: 'Dice', href: '/dice' },
  limbo: { label: 'Limbo', href: '/limbo' },
  wheel: { label: 'Wheel', href: '/wheel' },
  plinko: { label: 'Plinko', href: '/plinko' },
  mines: { label: 'Mines', href: '/mines' },
  hilo: { label: 'HiLo', href: '/hilo' },
  tower: { label: 'Tower', href: '/tower' },
  blackjack: { label: 'Blackjack', href: '/blackjack' },
  jackpot: { label: 'Jackpot', href: '/jackpot' },
  lottery: { label: 'Lottery', href: '/lottery' },
};

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
  const meta = GAME_META[bet.gameType] ?? { label: bet.gameType, href: '/' };
  const mult = bet.multiplier != null && bet.won ? `${bet.multiplier.toFixed(2)}×` : null;
  return (
    <Link
      href={meta.href}
      title={`${bet.player} · ${meta.label} · ${formatSol(bet.amountLamports)}`}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors',
        bet.won
          ? 'border-success/25 bg-success/5 hover:border-success/50'
          : 'border-border/60 bg-background/40 hover:border-border',
      )}
    >
      <span className="max-w-[72px] truncate font-medium text-foreground-muted">{bet.player}</span>
      <span className="text-foreground-muted/50">{meta.label}</span>
      <span className="font-mono tabular-nums text-foreground-muted">
        {formatSol(bet.amountLamports, 2)}
      </span>
      {mult ? (
        <span className="font-display font-semibold tabular-nums text-success">{mult}</span>
      ) : (
        <span className="font-semibold text-danger/70">—</span>
      )}
    </Link>
  );
}
