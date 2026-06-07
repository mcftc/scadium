'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  ChevronDown,
  Coins,
  Gamepad2,
  Spade,
  Ticket,
  TrendingUp,
  Trophy,
} from 'lucide-react';
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
  const [gamesOpen, setGamesOpen] = useState(false);
  const gamesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gamesOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!gamesRef.current?.contains(e.target as Node)) setGamesOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [gamesOpen]);

  // Close the dropdown on navigation.
  useEffect(() => setGamesOpen(false), [pathname]);

  const activeGame = games.find((g) => pathname.startsWith(g.href));

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/90 backdrop-blur-xl">
      <Container>
        <div className="flex h-14 items-center justify-between gap-3">
          {/* Left: Logo + Games dropdown + Terminal */}
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/crash" aria-label="Scadium home">
              <Logo />
            </Link>

            <div className="relative" ref={gamesRef}>
              <button
                type="button"
                onClick={() => setGamesOpen((o) => !o)}
                className={cn(
                  'flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-bold transition-colors hover:border-primary-400/50',
                  gamesOpen && 'border-primary-400/50',
                )}
              >
                <Gamepad2 className="h-4 w-4 text-primary-400" />
                <span className="hidden sm:inline">{activeGame?.label ?? 'Games'}</span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-foreground-muted transition-transform',
                    gamesOpen && 'rotate-180',
                  )}
                />
              </button>

              {gamesOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-2xl shadow-black/40">
                  {games.map((g) => {
                    const Icon = g.icon;
                    const chip = liveLabel(live, g.key);
                    const active = pathname.startsWith(g.href);
                    return (
                      <Link
                        key={g.key}
                        href={g.href}
                        className={cn(
                          'flex items-center justify-between rounded-lg px-2.5 py-2.5 transition-colors',
                          active
                            ? 'bg-surface-elevated text-foreground'
                            : 'text-foreground-muted hover:bg-surface-elevated hover:text-foreground',
                        )}
                      >
                        <span className="flex items-center gap-2.5 text-xs font-bold">
                          <Icon className="h-4 w-4 text-primary-400" />
                          {g.label}
                        </span>
                        {chip && (
                          <span
                            className={cn(
                              'rounded-md px-1.5 py-0.5 text-[10px] font-mono font-bold',
                              g.key === 'crash' && live?.crash.phase === 'running'
                                ? 'bg-success/15 text-success'
                                : 'bg-surface text-foreground-muted',
                            )}
                          >
                            {chip}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Terminal — the $SCAD token hub (Phase 7 expands this). */}
            <Link
              href="/trade"
              className={cn(
                'hidden md:flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors',
                pathname.startsWith('/trade') || pathname.startsWith('/token')
                  ? 'text-foreground bg-surface'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              <Activity className="h-4 w-4 text-primary-400" />
              Terminal
              <span className="rounded bg-primary-400/15 px-1 py-0.5 text-[9px] font-bold uppercase text-primary-300">
                Beta
              </span>
            </Link>

            <Link
              href="/leaderboard"
              className={cn(
                'hidden lg:block px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors',
                pathname === '/leaderboard'
                  ? 'text-foreground bg-surface-elevated'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              Leaderboard
            </Link>
          </div>

          {/* Right: $SCAD chip + Rewards + balance + avatar */}
          <div className="flex shrink-0 items-center gap-2.5">
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
            <UserMenu />
            <ConnectButton />
          </div>
        </div>
      </Container>
      <PromoBar />
    </header>
  );
}
