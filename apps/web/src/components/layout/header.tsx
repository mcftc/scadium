'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Coins, Spade, Ticket, TrendingUp, Trophy } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Logo } from '@/components/brand/logo';
import { ConnectButton } from '@/components/wallet/connect-button';
import { BalancePill } from '@/components/wallet/balance-pill';
import { RewardsDropdown } from '@/components/rewards/rewards-dropdown';
import { UserMenu } from '@/components/layout/user-menu';
import { PromoBar } from '@/components/layout/promo-bar';
import { usePlatformLive, type PlatformLive } from '@/hooks/use-platform';
import { cn } from '@/lib/cn';

/** Per-game live status chip text for the Games dropdown. */
function liveLabel(live: PlatformLive | undefined, key: string): string | null {
  if (!live) return null;
  switch (key) {
    case 'crash':
      return live.crash.phase === 'running' && live.crash.multiplier
        ? `${live.crash.multiplier.toFixed(2)}x`
        : 'Starting…';
    case 'coinflip':
      return `${live.coinflip.openCount} Flip${live.coinflip.openCount === 1 ? '' : 's'}`;
    case 'blackjack':
      return String(live.blackjack.active);
    case 'jackpot':
      return live.jackpot.status === 'open' ? `${live.jackpot.players} in` : 'Waiting…';
    case 'lottery': {
      const ms = Math.max(0, live.lottery.drawAt - Date.now());
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    default:
      return null;
  }
}

const games = [
  { key: 'crash', href: '/crash', label: 'Crash', icon: TrendingUp },
  { key: 'coinflip', href: '/coinflip', label: 'Coinflip', icon: Coins },
  { key: 'blackjack', href: '/blackjack', label: 'Blackjack', icon: Spade },
  { key: 'jackpot', href: '/jackpot', label: 'Jackpot', icon: Trophy },
  { key: 'lottery', href: '/lottery', label: 'Lottery', icon: Ticket },
];

/**
 * solpump-style top bar: logo + Games dropdown (live counters) + Terminal
 * link on the left; $SCAD chip, Rewards, balance, avatar menu on the right.
 * The promo strip renders directly under the bar.
 */
export function Header() {
  const pathname = usePathname();
  const { data: live } = usePlatformLive();

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/90 backdrop-blur-xl">
      <Container>
        <div className="flex h-14 items-center justify-between gap-2 sm:gap-3">
          {/* Left: Logo + inline game tabs (desktop) + Leaderboard */}
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <Link href="/crash" aria-label="Scadium home" className="shrink-0">
              <Logo />
            </Link>

            <nav className="hidden lg:flex items-center gap-0.5">
              {games.map((g) => (
                <GameTab
                  key={g.key}
                  game={g}
                  active={pathname.startsWith(g.href)}
                  chip={liveLabel(live, g.key)}
                  running={g.key === 'crash' && live?.crash.phase === 'running'}
                />
              ))}
            </nav>

            <Link
              href="/leaderboard"
              className={cn(
                'hidden xl:block px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors',
                pathname === '/leaderboard'
                  ? 'text-foreground bg-surface-elevated'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              Leaderboard
            </Link>
          </div>

          {/* Right: $SCAD chip + Rewards + balance + avatar */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            <Link
              href="/trade"
              className="hidden 2xl:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border whitespace-nowrap hover:border-primary-400/50 transition-colors"
            >
              <div className="h-1.5 w-1.5 rounded-full bg-gradient-primary animate-pulse-glow" />
              <span className="text-[10px] font-mono text-foreground-muted">$SCAD</span>
              <span className="text-[10px] font-bold">Trade</span>
            </Link>
            <RewardsDropdown />
            <BalancePill />
            <span className="hidden sm:block">
              <UserMenu />
            </span>
            <ConnectButton />
          </div>
        </div>
      </Container>

      {/* Mobile / tablet: horizontally-scrollable game strip */}
      <nav className="lg:hidden flex items-center gap-1 overflow-x-auto border-t border-border/50 px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {games.map((g) => (
          <GameTab
            key={g.key}
            game={g}
            active={pathname.startsWith(g.href)}
            chip={liveLabel(live, g.key)}
            running={g.key === 'crash' && live?.crash.phase === 'running'}
            showChip
          />
        ))}
      </nav>

      <PromoBar />
    </header>
  );
}

function GameTab({
  game,
  active,
  chip,
  running,
  showChip = false,
}: {
  game: (typeof games)[number];
  active: boolean;
  chip: string | null;
  running: boolean;
  // Live chip only shows in the scrollable strip; inline desktop tabs stay
  // compact so they don't crowd the right-side controls.
  showChip?: boolean;
}) {
  const Icon = game.icon;
  return (
    <Link
      href={game.href}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition-colors',
        active
          ? 'bg-surface-elevated text-foreground'
          : 'text-foreground-muted hover:bg-surface hover:text-foreground',
      )}
    >
      <Icon className={cn('h-4 w-4', active ? 'text-primary-400' : 'text-foreground-muted')} />
      {game.label}
      {showChip && chip && (
        <span
          className={cn(
            'rounded px-1 py-0.5 text-[9px] font-mono font-bold',
            running ? 'bg-success/15 text-success' : 'bg-surface text-foreground-muted',
          )}
        >
          {chip}
        </span>
      )}
    </Link>
  );
}
