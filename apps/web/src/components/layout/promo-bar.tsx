'use client';

import Link from 'next/link';
import { Sparkles, X } from 'lucide-react';
import { useHydrated } from '@/hooks/use-hydrated';
import { useLocalStorageValue, writeLocalStorageValue } from '@/hooks/use-local-storage-value';

const PROMO_KEY = 'scadium-promo-dismissed-v1';

/**
 * Thin dismissible promo strip under the header (solpump shell). Copy and
 * target are ours; bump PROMO_KEY when the campaign changes so it reappears.
 */
export function PromoBar() {
  // Hidden on the server + first client render (markup matches → no SSR flash),
  // then shown once hydrated unless previously dismissed.
  const hydrated = useHydrated();
  const dismissed = useLocalStorageValue(PROMO_KEY) === '1';
  const visible = hydrated && !dismissed;

  if (!visible) return null;

  return (
    <div className="border-b border-primary-400/20 bg-gradient-to-r from-primary-400/10 via-surface/50 to-primary-400/10">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-center gap-2 px-4 py-1.5">
        <Sparkles className="h-3 w-3 text-primary-400" />
        <span className="text-[11px] font-semibold">
          Trade <span className="text-primary-300">$SCAD</span> on our on-chain AMM — every bet
          feeds the buy-and-burn
        </span>
        <Link
          href="/trade"
          className="text-[11px] font-bold text-primary-400 hover:text-primary-300 transition-colors"
        >
          Check it out →
        </Link>
        <button
          type="button"
          aria-label="Dismiss promo"
          onClick={() => writeLocalStorageValue(PROMO_KEY, '1')}
          className="ml-2 rounded p-0.5 text-foreground-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
