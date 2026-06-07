'use client';

import { useMemo } from 'react';
import { Eye, Loader2, X, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useOpenCoinflips,
  useJoinCoinflip,
  useCancelCoinflip,
  type CoinflipGame,
} from '@/hooks/use-coinflip';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useMe } from '@/hooks/use-me';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { formatSol, shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { FlipSort } from './coinflip-lobby';

export function OpenFlipsList({
  sort,
  onWatch,
}: {
  sort: FlipSort;
  onWatch: (game: CoinflipGame) => void;
}) {
  const { data, isLoading } = useOpenCoinflips();
  const { isAuthenticated } = useWalletAuth();
  const { data: me } = useMe();
  const { open: openWallet } = useWalletModal();
  const joinMutation = useJoinCoinflip();
  const cancelMutation = useCancelCoinflip();

  const sorted = useMemo(() => {
    const list = [...(data ?? [])];
    if (sort === 'price') {
      list.sort((a, b) => Number(BigInt(b.amountLamports) - BigInt(a.amountLamports)));
    } else {
      list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    }
    return list;
  }, [data, sort]);

  if (isLoading) {
    return <div className="py-12 text-center text-foreground-muted text-sm">Loading...</div>;
  }

  if (sorted.length === 0) {
    return (
      <div className="py-16 text-center text-foreground-muted text-sm">
        No active flips. Click <span className="text-primary-400">Create Flip</span> to start one.
      </div>
    );
  }

  /** Join through the flip theater: open the modal first, then fire the
   * mutation — the resolved socket event drives the animation inside it. */
  function joinWithModal(flip: CoinflipGame) {
    if (!isAuthenticated) return openWallet();
    onWatch(flip);
    joinMutation.mutate(flip.id);
  }

  return (
    <div className="divide-y divide-border/30">
      {sorted.map((flip) => {
        const isOwn = me?.id === flip.creatorId;
        const pending =
          joinMutation.isPending && joinMutation.variables === flip.id
            ? 'join'
            : cancelMutation.isPending && cancelMutation.variables === flip.id
              ? 'cancel'
              : null;
        return (
          <div
            key={flip.id}
            className="grid grid-cols-[1fr_110px_130px_120px] gap-4 items-center px-5 py-3 hover:bg-surface-elevated/30 transition-colors"
          >
            {/* Players: Creator VS ??? */}
            <div className="flex items-center gap-3 min-w-0">
              <PlayerAvatar
                name={flip.creatorUsername ?? shortAddress(flip.creatorWallet ?? '')}
                side={flip.creatorSide}
              />
              <Swords className="h-4 w-4 text-foreground-muted/50 shrink-0" />
              <div className="h-8 w-8 rounded-full border-2 border-dashed border-border/60 flex items-center justify-center text-[10px] text-foreground-muted shrink-0">
                ?
              </div>
            </div>

            {/* Side */}
            <div className="text-center">
              <span
                className={cn(
                  'inline-block px-3 py-1 rounded-full text-xs font-bold uppercase',
                  flip.creatorSide === 'heads'
                    ? 'bg-primary-400/15 text-primary-400 border border-primary-400/30'
                    : 'bg-cyan-400/15 text-cyan-400 border border-cyan-400/30',
                )}
              >
                {flip.creatorSide}
              </span>
            </div>

            {/* Amount */}
            <div className="text-right font-mono font-bold text-sm">
              {formatSol(flip.amountLamports, 4)}
            </div>

            {/* Actions: watch (everyone) + join/cancel */}
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => onWatch(flip)}
                aria-label="Watch this flip"
                title="Watch"
                className="rounded-lg p-1.5 text-foreground-muted hover:bg-surface-elevated hover:text-foreground transition-colors"
              >
                <Eye className="h-4 w-4" />
              </button>
              {isOwn ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => cancelMutation.mutate(flip.id)}
                  disabled={pending === 'cancel'}
                  className="text-xs"
                >
                  {pending === 'cancel' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                  Cancel
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={() => joinWithModal(flip)}
                  disabled={pending === 'join'}
                  className="flex items-center gap-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
                >
                  {pending === 'join' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Join
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlayerAvatar({ name, side }: { name: string; side: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className={cn(
          'h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
          side === 'heads'
            ? 'bg-gradient-to-br from-primary-400 to-primary-700 text-white'
            : 'bg-gradient-to-br from-cyan-400 to-cyan-700 text-white',
        )}
      >
        {name.charAt(0).toUpperCase()}
      </div>
      <span className="text-sm font-semibold truncate">{name}</span>
    </div>
  );
}
