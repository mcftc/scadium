'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TrendingUp, Coins, Spade, Ticket, Trophy } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Logo } from '@/components/brand/logo';
import { ConnectButton } from '@/components/wallet/connect-button';
import { BalancePill } from '@/components/wallet/balance-pill';
import { RewardsDropdown } from '@/components/rewards/rewards-dropdown';
import { cn } from '@/lib/cn';

const gameNavItems = [
  { href: '/crash', label: 'Crash', icon: TrendingUp },
  { href: '/coinflip', label: 'CoinFlip', icon: Coins },
  { href: '/blackjack', label: 'Blackjack', icon: Spade },
  { href: '/lottery', label: 'Lottery', icon: Ticket },
  { href: '/jackpot', label: 'Jackpot', icon: Trophy },
];

const secondaryNavItems = [
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/airdrop', label: 'Airdrop' },
  { href: '/fairness', label: 'Provably Fair' },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/90 backdrop-blur-xl">
      <Container>
        <div className="flex h-14 items-center justify-between">
          {/* Left: Logo + Game tabs */}
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/crash" aria-label="Scadium home">
              <Logo />
            </Link>

            {/* Game tabs — prominent, icon+label like solpump */}
            <nav className="hidden md:flex items-center gap-0.5 bg-surface/50 rounded-xl p-1 border border-border/50">
              {gameNavItems.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition-all',
                      active
                        ? 'bg-surface-elevated text-foreground shadow-sm'
                        : 'text-foreground-muted hover:text-foreground hover:bg-surface-elevated/50',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            {/* Secondary nav */}
            <nav className="hidden lg:flex items-center gap-1">
              {secondaryNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors',
                    pathname === item.href
                      ? 'text-foreground bg-surface-elevated'
                      : 'text-foreground-muted hover:text-foreground',
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right: Token ticker + Connect */}
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden 2xl:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border whitespace-nowrap">
              <div className="h-1.5 w-1.5 rounded-full bg-gradient-primary animate-pulse-glow" />
              <span className="text-[10px] font-mono text-foreground-muted">$SCADIUM</span>
              <span className="text-[10px] font-bold">$0.0305</span>
            </div>
            <RewardsDropdown />
            <BalancePill />
            <ConnectButton />
          </div>
        </div>
      </Container>

      {/* Announcement banner like solpump */}
      {pathname === '/crash' && (
        <div className="border-t border-border/30 bg-surface/30">
          <Container>
            <div className="py-1.5 text-center text-[10px] uppercase tracking-[0.2em] text-foreground-muted/60 font-medium">
              Scadium: Solana&apos;s most trusted decentralized casino
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
