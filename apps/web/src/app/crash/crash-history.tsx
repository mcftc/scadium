'use client';

import Link from 'next/link';
import { cn } from '@/lib/cn';
import { fairnessHref } from '@/lib/fairness-link';
import type { CrashHistoryItem } from '@/hooks/use-crash';

/**
 * The last rounds' busts — each one a link that opens the verifier pre-filled
 * with that round's revealed seeds (and beacon round), so any past bust can be
 * checked in one click.
 */
export function CrashHistory({ history }: { history: CrashHistoryItem[] }) {
  if (history.length === 0) {
    return null;
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {history.slice(0, 20).map((h) => {
        const big = h.bustPoint >= 2;
        const huge = h.bustPoint >= 10;
        return (
          <Link
            key={h.roundId}
            href={fairnessHref('crash', {
              serverSeed: h.serverSeed,
              serverSeedHash: h.serverSeedHash,
              clientSeed: h.clientSeed,
              nonce: h.nonce,
              beaconRound: h.beaconRound,
              slotHash: h.slotHash,
            })}
            title="Verify this round"
            className={cn(
              'shrink-0 px-3 py-1 rounded-lg text-xs font-semibold font-display tabular-nums border transition-opacity hover:opacity-80',
              huge
                ? 'bg-primary-400/20 border-primary-400/50 text-primary-400'
                : big
                  ? 'bg-success/10 border-success/30 text-success'
                  : h.bustPoint < 1.5
                    ? 'bg-danger/10 border-danger/30 text-danger'
                    : 'bg-surface-elevated border-border text-foreground-muted',
            )}
          >
            {h.bustPoint.toFixed(2)}×
          </Link>
        );
      })}
    </div>
  );
}
