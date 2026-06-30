'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Zap, Vault, Coins, Layers, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/engine', label: 'Engine', icon: Zap },
  { href: '/vault', label: 'Vault', icon: Vault },
  { href: '/token', label: 'Token', icon: Coins },
  { href: '/pools', label: 'Pools', icon: Layers },
];

/**
 * Sub-navigation for the SCAD Engine section. The header "SCAD Engine" entry is
 * now a direct link to /engine (no dropdown), so the sub-pages are reached from
 * this in-page tab row instead.
 */
export function EngineSubNav() {
  const pathname = usePathname();
  return (
    <div className="mb-8 flex flex-wrap justify-center gap-2">
      {LINKS.map((l) => {
        const Icon = l.icon;
        const active = pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-bold transition-colors',
              active
                ? 'border-primary-400/40 bg-surface-elevated text-primary-400'
                : 'border-border bg-surface text-foreground hover:border-primary-400/40',
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
