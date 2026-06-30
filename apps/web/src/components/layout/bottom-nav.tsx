'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Gamepad2,
  ShoppingCart,
  Trophy,
  Gift,
  Menu as MenuIcon,
  TrendingUp,
  Coins,
  Spade,
  Ticket,
  Dices,
  Rocket,
  Circle,
  Bomb,
  Gem,
  Layers,
  ArrowUpDown,
  Zap,
  Vault,
  Users,
  BarChart3,
  Settings,
  ShieldCheck,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useHydrated } from '@/hooks/use-hydrated';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/cn';

type NavLink = { href: string; label: string; icon: LucideIcon };

const GAMES: NavLink[] = [
  { href: '/crash', label: 'Crash', icon: TrendingUp },
  { href: '/coinflip', label: 'Coinflip', icon: Coins },
  { href: '/blackjack', label: 'Blackjack', icon: Spade },
  { href: '/jackpot', label: 'Jackpot', icon: Trophy },
  { href: '/lottery', label: 'Lottery', icon: Ticket },
  { href: '/dice', label: 'Dice', icon: Dices },
  { href: '/limbo', label: 'Limbo', icon: Rocket },
  { href: '/plinko', label: 'Plinko', icon: Circle },
  { href: '/wheel', label: 'Wheel', icon: Bomb },
  { href: '/mines', label: 'Mines', icon: Gem },
  { href: '/tower', label: 'Tower', icon: Layers },
  { href: '/hilo', label: 'Hi-Lo', icon: ArrowUpDown },
];

const ENGINE_LINKS: NavLink[] = [
  { href: '/engine', label: 'Engine', icon: Zap },
  { href: '/vault', label: 'Vault', icon: Vault },
  { href: '/token', label: 'Token', icon: Coins },
  { href: '/pools', label: 'Pools', icon: Layers },
];

const ACCOUNT_LINKS: NavLink[] = [
  { href: '/profile', label: 'Statistics', icon: BarChart3 },
  { href: '/affiliates', label: 'Affiliates', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/fairness', label: 'Fairness', icon: ShieldCheck },
];

/**
 * Mobile bottom navigation (< lg). All primary navigation lives here as large,
 * high-contrast tabs so it's reachable with a thumb and clearly visible — the
 * cramped, low-contrast top-header menu rows were moved down here. Games and
 * More open slide-up bottom sheets; the rest are direct links. Hidden on
 * desktop, where the top header nav takes over.
 */
export function BottomNav() {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<'games' | 'more' | null>(null);
  const clear = useAuthStore((s) => s.clear);
  const token = useAuthStore((s) => s.accessToken);

  // Close any open sheet on route change.
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    if (sheet) setSheet(null);
  }

  const onGame = GAMES.some((g) => pathname.startsWith(g.href));

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <TabButton
          icon={Gamepad2}
          label="Games"
          active={onGame || sheet === 'games'}
          onClick={() => setSheet((s) => (s === 'games' ? null : 'games'))}
        />
        <TabLink icon={ShoppingCart} label="Buy" href="/trade" active={pathname.startsWith('/trade')} />
        <TabLink
          icon={Trophy}
          label="Ranks"
          href="/leaderboard"
          active={pathname.startsWith('/leaderboard')}
        />
        <TabLink icon={Gift} label="Rewards" href="/airdrop" active={pathname.startsWith('/airdrop')} />
        <TabButton
          icon={MenuIcon}
          label="More"
          active={sheet === 'more'}
          onClick={() => setSheet((s) => (s === 'more' ? null : 'more'))}
        />
      </nav>

      <Sheet open={sheet === 'games'} title="Games" onClose={() => setSheet(null)}>
        <div className="grid grid-cols-3 gap-2">
          {GAMES.map((g) => (
            <SheetTile key={g.href} link={g} active={pathname.startsWith(g.href)} />
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === 'more'} title="Menu" onClose={() => setSheet(null)}>
        <SheetSection label="SCAD Engine" links={ENGINE_LINKS} pathname={pathname} />
        <SheetSection label="Account" links={ACCOUNT_LINKS} pathname={pathname} />
        {token && (
          <button
            type="button"
            onClick={() => {
              clear();
              setSheet(null);
            }}
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-3 text-sm font-semibold text-danger transition-colors hover:bg-danger/10"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        )}
      </Sheet>
    </>
  );
}

function tabClasses(active: boolean) {
  return cn(
    'relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors',
    active ? 'text-primary-400' : 'text-foreground hover:text-primary-300',
  );
}

function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={tabClasses(active)} aria-label={label}>
      {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-primary-400" />}
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

function TabLink({
  icon: Icon,
  label,
  href,
  active,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link href={href} className={tabClasses(active)} aria-label={label}>
      {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-primary-400" />}
      <Icon className="h-5 w-5" />
      {label}
    </Link>
  );
}

function SheetTile({ link, active }: { link: NavLink; active: boolean }) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-semibold transition-colors',
        active
          ? 'border-primary-400/40 bg-surface-elevated text-primary-400'
          : 'border-border bg-surface text-foreground hover:border-primary-400/40',
      )}
    >
      <Icon className="h-5 w-5 text-primary-400" />
      {link.label}
    </Link>
  );
}

function SheetSection({
  label,
  links,
  pathname,
}: {
  label: string;
  links: NavLink[];
  pathname: string;
}) {
  return (
    <div className="mb-2">
      <div className="px-1.5 pb-1 pt-2 text-[10px] uppercase tracking-wider text-foreground-muted">
        {label}
      </div>
      {links.map((l) => {
        const Icon = l.icon;
        const active = pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-3 text-sm font-semibold transition-colors',
              active
                ? 'bg-surface-elevated text-primary-400'
                : 'text-foreground hover:bg-surface-elevated',
            )}
          >
            <Icon className="h-4 w-4 text-primary-400" />
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Portal-rendered slide-up sheet (mirrors NavDropdown's bottom sheet). */
function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const mounted = useHydrated();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface/95 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-xl"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" aria-hidden />
            <div className="mb-2 px-1.5 text-[10px] uppercase tracking-wider text-foreground-muted">
              {title}
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
