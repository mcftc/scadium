'use client';

import Link from 'next/link';
import { useCustodyConfig } from '@/hooks/use-custody';

/**
 * Site-wide notice while wallet deposits run on a test network (ADR 0005): the
 * SOL moving through the wallet page is devnet SOL with no value.
 */
export function CustodyBanner() {
  const { data } = useCustodyConfig();
  if (!data?.enabled || !data.cluster || data.cluster === 'mainnet-beta') return null;
  return (
    <div className="w-full bg-primary-400/10 px-4 py-2 text-center text-xs font-semibold text-primary-300">
      Test network: wallet deposits and withdrawals use {data.cluster} SOL with no real value.{' '}
      <Link href="/wallet" className="underline">
        How to play with your wallet
      </Link>
    </div>
  );
}
