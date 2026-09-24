'use client';

import Link from 'next/link';
import { useNeedsDeposit } from '@/hooks/use-custody';

/**
 * Jackpot and lottery pay one pot shared by the round, so while wallet deposits
 * are on they take deposited SOL only (ADR 0005). Tells a play-money account
 * why, instead of letting it hit the API's refusal.
 */
export function DepositToPlay({ game }: { game: string }) {
  if (!useNeedsDeposit()) return null;
  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
      {game} is played with deposited SOL.{' '}
      <Link href="/wallet" className="underline font-semibold">
        Deposit
      </Link>{' '}
      to join — play money stays on crash and coinflip.
    </div>
  );
}
