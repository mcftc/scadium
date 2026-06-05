'use client';

import Link from 'next/link';
import { useMe } from '@/hooks/use-me';
import { lamportsToSol } from '@/lib/format';

/**
 * Play-money balance pill shown in the header once authenticated. This is the
 * `User.playBalanceLamports` gambling balance (seeded at 10 SOL) — the balance
 * the API actually debits/credits on every bet, NOT the on-chain wallet balance.
 */
export function BalancePill() {
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <Link
      href="/wallet"
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border whitespace-nowrap hover:border-primary-400/50 transition-colors"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
        <defs>
          <linearGradient id="sol-pill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9945FF" />
            <stop offset="100%" stopColor="#14F195" />
          </linearGradient>
        </defs>
        <path
          fill="url(#sol-pill)"
          d="M4 17.5l3-3h13l-3 3H4zm0-5.5l3-3h13l-3 3H4zm3-8.5h13l-3 3H4l3-3z"
        />
      </svg>
      <span className="text-xs font-bold font-mono tabular-nums">
        {lamportsToSol(me.playBalanceLamports).toFixed(3)}
      </span>
      <span className="text-[10px] font-semibold text-foreground-muted">SOL</span>
    </Link>
  );
}
