'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Coins,
  Gamepad2,
  Gift,
  Layers,
  Link2,
  ShoppingCart,
  Users,
  Vault,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Logo } from '@/components/brand/logo';
import { ConnectButton } from '@/components/wallet/connect-button';
import { BalancePill } from '@/components/wallet/balance-pill';
import { RewardsDropdown } from '@/components/rewards/rewards-dropdown';
import { UserMenu } from '@/components/layout/user-menu';
import { PromoBar } from '@/components/layout/promo-bar';
import { NavDropdown } from '@/components/layout/nav-dropdown';
import { usePlatformLive, type PlatformLive } from '@/hooks/use-platform';
import { cn } from '@/lib/cn';
import { GAMES, STATEFUL_GAMES, INSTANT_GAMES, type GameMeta } from '@/config/games';

/** Per-game live status chip text for the stateful games in the Games menu. */
function liveLabel(live: PlatformLive | undefined, key: string): string | null {
  if (!live) return null;
  switch (key) {
    // Each key is optional — /platform/live reports only the enabled games — so
    // every branch bails out rather than assuming its game is in the response.
    case 'crash':
      if (!live.crash) return null;
      return live.crash.phase === 'running' && live.crash.multiplier
        ? `${live.crash.multiplier.toFixed(2)}x`
        : 'Starting…';
    case 'coinflip':
      if (!live.coinflip) return null;
      return `${live.coinflip.openCount} Flip${live.coinflip.openCount === 1 ? '' : 's'}`;
    case 'blackjack':
      return live.blackjack ? String(live.blackjack.active) : null;
    case 'jackpot':
      if (!live.jackpot) return null;
      return live.jackpot.status === 'open' ? `${live.jackpot.players} in` : 'Waiting…';
    case 'lottery': {
      if (!live.lottery) return null;
      const ms = Math.max(0, live.lottery.drawAt - Date.now());
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    default:
      return null;
  }
}

const engineLinks = [
  { href: '/engine', label: 'Engine', icon: Zap },
  { href: '/vault', label: 'Vault', icon: Vault },
  { href: '/token', label: 'Token', icon: Coins },
  { href: '/pools', label: 'Pools', icon: Layers },
];

// `/affiliates` is a single route; these deep-link to its in-page sections
// (anchor ids on the dashboard cards). The overview row is the page top.
const affiliateLinks: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/affiliates', label: 'Overview', icon: Users },
  { href: '/affiliates#referral-link', label: 'Referral link', icon: Link2 },
  { href: '/affiliates#recent-referrals', label: 'Recent referrals', icon: Users },
  { href: '/affiliates#commission-tiers', label: 'Commission tiers', icon: Gift },
];

/**
 * Top bar: logo + Games dropdown (games on the registry's menu, live chips
 * for the stateful ones) + Trade + SCAD Engine link on the left; Rewards,
 * balance, avatar on the right. The promo strip renders under the bar.
 */
export function Header() {
  const pathname = usePathname();
  const { data: live } = usePlatformLive();
  const onGame = GAMES.some((g) => pathname.startsWith(g.href));
  const onEngine = engineLinks.some((l) => pathname.startsWith(l.href));
  const onAffiliates = pathname.startsWith('/affiliates');

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/90 backdrop-blur-xl">
      <Container>
        <div className="flex h-14 items-center justify-between gap-2 sm:gap-3">
          {/* Left: Logo + Games dropdown + Trade + Engine + Leaderboard */}
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <Link href="/crash" aria-label="Scadium home" className="shrink-0">
              <Logo />
            </Link>

            <nav className="hidden lg:flex items-center gap-0.5">
              <NavDropdown
                label="Games"
                active={onGame}
                width="w-72"
                icon={<Gamepad2 className="h-4 w-4 text-primary-400" />}
              >
                {(close) => (
                  <div className="space-y-0.5">
                    {/* Stateful (live) games keep their realtime chip; instant games just link. */}
                    {STATEFUL_GAMES.map((g) => (
                      <GameMenuItem
                        key={g.id}
                        game={g}
                        active={pathname.startsWith(g.href)}
                        chip={liveLabel(live, g.id)}
                        running={g.id === 'crash' && live?.crash?.phase === 'running'}
                        onClick={close}
                      />
                    ))}
                    {INSTANT_GAMES.map((g) => (
                      <GameMenuItem
                        key={g.id}
                        game={g}
                        active={pathname.startsWith(g.href)}
                        chip={null}
                        running={false}
                        onClick={close}
                      />
                    ))}
                  </div>
                )}
              </NavDropdown>

              <Link
                href="/trade"
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold whitespace-nowrap transition-all',
                  pathname.startsWith('/trade')
                    ? 'bg-surface-elevated text-primary-400 ring-1 ring-primary-400/30'
                    : 'text-foreground hover:bg-surface-elevated hover:text-primary-300',
                )}
              >
                <ShoppingCart className="h-4 w-4 text-primary-400" />
                Trade
              </Link>

              <Link
                href="/engine"
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold whitespace-nowrap transition-all',
                  onEngine
                    ? 'bg-surface-elevated text-primary-400 ring-1 ring-primary-400/30'
                    : 'text-foreground hover:bg-surface-elevated hover:text-primary-300',
                )}
              >
                <Zap className="h-4 w-4 text-primary-400" />
                SCAD Engine
              </Link>

              <NavDropdown label="Affiliates" active={onAffiliates} width="w-56">
                {(close) => <LinkMenu links={affiliateLinks} pathname={pathname} onClick={close} />}
              </NavDropdown>
            </nav>

            <Link
              href="/leaderboard"
              className={cn(
                'hidden xl:block px-3 py-2 text-sm font-bold rounded-lg whitespace-nowrap transition-all',
                pathname === '/leaderboard'
                  ? 'bg-surface-elevated text-primary-400 ring-1 ring-primary-400/30'
                  : 'text-foreground hover:bg-surface-elevated hover:text-primary-300',
              )}
            >
              Leaderboard
            </Link>
          </div>

          {/* Right: Rewards + balance + avatar */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            <RewardsDropdown />
            <BalancePill />
            <span className="hidden sm:block">
              <UserMenu />
            </span>
            <ConnectButton />
          </div>
        </div>
      </Container>

      {/* Mobile/tablet nav lives in the fixed BottomNav (AppShell), so the
          header stays a slim top bar below lg. */}

      <PromoBar />
    </header>
  );
}

/** Shared icon-link menu body for the Engine + Affiliates dropdowns. Supports
 *  hash deep-links (`/affiliates#anchor`); only the plain-route item highlights
 *  as active so hash rows don't all light up at once. */
function LinkMenu({
  links,
  pathname,
  onClick,
}: {
  links: { href: string; label: string; icon: LucideIcon }[];
  pathname: string;
  onClick: () => void;
}) {
  return (
    <>
      {links.map((l) => {
        const Icon = l.icon;
        const hasHash = l.href.includes('#');
        const active = !hasHash && pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            onClick={onClick}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors',
              active
                ? 'bg-surface-elevated text-foreground'
                : 'text-foreground-muted hover:bg-surface hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 text-primary-400" />
            {l.label}
          </Link>
        );
      })}
    </>
  );
}

function GameMenuItem({
  game,
  active,
  chip,
  running,
  onClick,
}: {
  game: GameMeta;
  active: boolean;
  chip: string | null;
  running: boolean;
  onClick: () => void;
}) {
  const Icon = game.icon;
  return (
    <Link
      href={game.href}
      onClick={onClick}
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors',
        active
          ? 'bg-surface-elevated text-foreground'
          : 'text-foreground-muted hover:bg-surface hover:text-foreground',
      )}
    >
      <span className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', active ? 'text-primary-400' : 'text-foreground-muted')} />
        {game.label}
      </span>
      {chip && (
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[9px] font-mono font-bold',
            running ? 'bg-success/15 text-success' : 'bg-surface text-foreground-muted',
          )}
        >
          {chip}
        </span>
      )}
    </Link>
  );
}
