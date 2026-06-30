'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Gamepad2,
  ShoppingCart,
  Zap,
  Gift,
  Users,
  User,
  TrendingUp,
  Coins,
  Spade,
  Ticket,
  Trophy,
  Dices,
  Rocket,
  Circle,
  Bomb,
  Gem,
  Layers,
  ArrowUpDown,
  type LucideIcon,
} from 'lucide-react';
import { useHydrated } from '@/hooks/use-hydrated';
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

/** Engine section routes — the Engine tab stays lit across all of them, mirroring the header link. */
const ENGINE_PATHS = ['/engine', '/vault', '/token', '/pools'];

/**
 * Mobile bottom navigation (< lg): a FLOATING rounded bar (detached from all four
 * edges, like the chat button) with six clearly-labelled tabs — Games, Trade,
 * SCAD Engine, Rewards, Affiliates, Profile. Games opens a slide-up sheet; the
 * rest are direct links. Hidden on desktop, where the top header nav takes over.
 */
export function BottomNav() {
  const pathname = usePathname();
  const [gamesOpen, setGamesOpen] = useState(false);

  // Close the sheet on route change.
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    if (gamesOpen) setGamesOpen(false);
  }

  const onGame = GAMES.some((g) => pathname.startsWith(g.href));

  return (
    <>
      <nav
        className="fixed inset-x-3 z-40 flex items-stretch justify-around gap-0.5 rounded-2xl border border-border bg-surface/95 px-1 py-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl lg:hidden"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
      >
        <TabButton
          icon={Gamepad2}
          label="Games"
          active={onGame || gamesOpen}
          onClick={() => setGamesOpen((o) => !o)}
        />
        <TabLink
          icon={ShoppingCart}
          label="Trade"
          href="/trade"
          active={pathname.startsWith('/trade')}
        />
        <TabLink
          icon={Zap}
          label="Engine"
          href="/engine"
          active={ENGINE_PATHS.some((p) => pathname.startsWith(p))}
        />
        <TabLink
          icon={Gift}
          label="Rewards"
          href="/airdrop"
          active={pathname.startsWith('/airdrop')}
        />
        <TabLink
          icon={Users}
          label="Affiliates"
          href="/affiliates"
          active={pathname.startsWith('/affiliates')}
        />
        <TabLink
          icon={User}
          label="Profile"
          href="/profile"
          active={pathname.startsWith('/profile')}
        />
      </nav>

      <Sheet open={gamesOpen} title="Games" onClose={() => setGamesOpen(false)}>
        <div className="grid grid-cols-3 gap-2">
          {GAMES.map((g) => (
            <SheetTile
              key={g.href}
              link={g}
              active={pathname.startsWith(g.href)}
              onSelect={() => setGamesOpen(false)}
            />
          ))}
        </div>
      </Sheet>
    </>
  );
}

function tabClasses(active: boolean) {
  return cn(
    'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10px] font-semibold transition-colors',
    active ? 'bg-surface-elevated text-primary-400' : 'text-foreground hover:text-primary-300',
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
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={tabClasses(active)}
      aria-label={label}
    >
      <Icon className="h-5 w-5" />
      <span className="max-w-full truncate leading-none">{label}</span>
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
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={tabClasses(active)}
      aria-label={label}
    >
      <Icon className="h-5 w-5" />
      <span className="max-w-full truncate leading-none">{label}</span>
    </Link>
  );
}

function SheetTile({
  link,
  active,
  onSelect,
}: {
  link: NavLink;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
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
  const reduce = useReducedMotion();

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
            initial={reduce ? { y: 0 } : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduce ? { y: 0 } : { y: '100%' }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 38 }}
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
