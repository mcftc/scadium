'use client';

import type { CrashBet } from '@/hooks/use-crash';
import { shortAddress, formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Live bets list (solpump "N Playing" panel): initial-avatar + name + stake,
 * with a gray JOINED badge while riding and a green payout tag once (partly)
 * cashed out.
 */
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
        // != null also covers undefined — the socket payload may omit the field
        const cashed = bet.cashedOutAt != null;
        const partial = !cashed && BigInt(bet.payoutLamports ?? '0') > BigInt(0);
        const name = bet.username ?? shortAddress(bet.walletAddress);
        const stake = bet.originalAmountLamports ?? bet.amountLamports;
        return (
          <div
            key={bet.userId}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs',
              cashed || partial
                ? 'bg-success/10 text-success'
                : 'bg-surface-elevated text-foreground',
            )}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-primary text-[9px] font-bold text-white">
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1 font-semibold truncate">{name}</span>
            <span className="font-mono text-foreground-muted">{formatSol(stake, 3)}</span>
            {cashed || partial ? (
              <span className="rounded-md bg-emerald-500/15 border border-emerald-400/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                +{formatSol(bet.payoutLamports ?? '0', 4)}
                {cashed ? ` @ ${bet.cashedOutAt!.toFixed(2)}×` : ''}
              </span>
            ) : (
              <span className="rounded-md bg-surface px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-muted">
                Joined
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
