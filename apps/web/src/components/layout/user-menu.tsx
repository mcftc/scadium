'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  ChevronDown,
  FileText,
  HelpCircle,
  LogOut,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { useMe } from '@/hooks/use-me';
import { shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';

const menuItems = [
  { href: '/profile', label: 'Statistics', icon: BarChart3 },
  { href: '/affiliates', label: 'Affiliates', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/profile#bets', label: 'Transactions', icon: Receipt },
  { href: '/fairness', label: 'Fairness', icon: ShieldCheck },
  { href: '/tos', label: 'TOS', icon: FileText },
  { href: '/faq', label: 'FAQ', icon: HelpCircle },
];

/**
 * Header avatar dropdown (solpump shell): quick links into the profile
 * suite + sign out. Routes point at today's pages; the profile-suite phase
 * remaps them to /profile/* tabs.
 */
export function UserMenu() {
  const token = useAuthStore((s) => s.accessToken);
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!token || !me) return null;

  const name = me.username ?? shortAddress(me.walletAddress);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-xl border border-border bg-surface px-1.5 py-1 transition-colors hover:border-primary-400/50',
          open && 'border-primary-400/50',
        )}
        aria-label="Account menu"
      >
        <Avatar src={me.avatarUrl} name={name} className="h-7 w-7 rounded-lg text-[11px]" />
        <ChevronDown
          className={cn('h-3.5 w-3.5 text-foreground-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-2xl shadow-black/40">
          <div className="px-2.5 py-2 border-b border-border mb-1">
            <div className="text-xs font-bold truncate">{name}</div>
            <div className="text-[10px] text-foreground-muted">Lv {me.level ?? 0}</div>
          </div>
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => {
              clear();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
