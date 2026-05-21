'use client';

import { Check } from 'lucide-react';
import type { CrashBet } from '@/hooks/use-crash';
import { shortAddress, formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';

export function CrashPlayersList({ bets }: { bets: CrashBet[] }) {
  if (bets.length === 0) {
    return <div className="py-6 text-center text-xs text-foreground-muted">No bets yet</div>;
  }
  const sorted = [...bets].sort((a, b) => {
    const aCash = a.cashedOutAt ?? 0;
    const bCash = b.cashedOutAt ?? 0;
    return bCash - aCash;
  });
  return (
    <div className="space-y-1">
      {sorted.map((bet) => {
        const cashed = bet.cashedOutAt !== null;
        const payout = cashed
          ? (BigInt(bet.amountLamports) * BigInt(Math.floor(bet.cashedOutAt! * 100))) /
            BigInt(100)
          : BigInt(bet.amountLamports);
        const name = bet.username ?? shortAddress(bet.walletAddress);
        return (
          <div
            key={bet.userId}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs',
              cashed ? 'bg-success/10 text-success' : 'bg-surface-elevated text-foreground',
            )}
          >
            <span className="flex-1 font-semibold truncate">{name}</span>
            {cashed ? (
              <>
                <span className="font-mono">{bet.cashedOutAt!.toFixed(2)}×</span>
                <Check className="h-3 w-3" />
              </>
            ) : (
              <span className="font-mono text-foreground-muted">
                {formatSol(bet.amountLamports, 3)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
