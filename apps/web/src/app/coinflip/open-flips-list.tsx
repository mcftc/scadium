'use client';

import { Eye, Landmark, Loader2, X, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useOpenCoinflips,
  useJoinCoinflip,
  useCancelCoinflip,
  usePlayHouse,
  type CoinflipGame,
} from '@/hooks/use-coinflip';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useMe } from '@/hooks/use-me';
import { useCustodyConfig } from '@/hooks/use-custody';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { formatSol, shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { FlipSort } from './coinflip-lobby';

/**
 * The lobby's open flips. One row layout for every width: stacked as a card on
 * phones (Join/Cancel full width — the old fixed-width table pushed them
 * off-screen at 375px), a four-column grid from `sm` up.
 */
export function OpenFlipsList({
  sort,
  onWatch,
  onJoinFailed,
}: {
  sort: FlipSort;
  onWatch: (game: CoinflipGame) => void;
  /** Called when a join request fails so the parent can close the flip modal. */
  onJoinFailed?: () => void;
}) {
  const { data, isLoading, isError } = useOpenCoinflips(sort === 'price' ? 'amount' : 'newest');
  const { isAuthenticated } = useWalletAuth();
  const { data: me } = useMe();
  const { data: custody } = useCustodyConfig();
  const { open: openWallet } = useWalletModal();
  const joinMutation = useJoinCoinflip();
  const cancelMutation = useCancelCoinflip();
  const houseMutation = usePlayHouse();

  // Socket-inserted flips land at the top; keep the chosen order locally too.
  const sorted = [...(data ?? [])].sort((a, b) =>
    sort === 'price'
      ? Number(BigInt(b.amountLamports) - BigInt(a.amountLamports))
      : Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  if (isLoading) {
    return <div className="py-12 text-center text-foreground-muted text-sm">Loading...</div>;
  }

  if (isError && sorted.length === 0) {
    // Not "no flips": the list could not be read (a cold server, say).
    return (
      <div className="py-16 text-center text-foreground-muted text-sm">
        Couldn&apos;t load the lobby — it will refresh when the server is back.
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="py-16 text-center text-foreground-muted text-sm">
        No active flips. <span className="text-primary-400">Create a flip</span> or play the house.
      </div>
    );
  }

  /** Join through the flip theater: open the modal first, then fire the
   * mutation — its response (or the socket, whichever lands first) drives the
   * animation. A failed join closes the modal again so it cannot hang. */
  function joinWithModal(flip: CoinflipGame) {
    if (!isAuthenticated) return openWallet();
    onWatch(flip);
    joinMutation.mutate(flip.id, { onError: () => onJoinFailed?.() });
  }

  function houseWithModal(flip: CoinflipGame) {
    onWatch(flip);
    houseMutation.mutate(flip.id, { onError: () => onJoinFailed?.() });
  }

  const actionError = joinMutation.error ?? cancelMutation.error ?? houseMutation.error;

  return (
    <div className="divide-y divide-border/30">
      {actionError ? (
        <div className="px-5 py-2.5 text-xs text-danger bg-danger/5">
          {actionError instanceof Error ? actionError.message : 'Action failed'}
        </div>
      ) : null}
      {sorted.map((flip) => {
        const isOwn = me?.id === flip.creatorId;
        // While custody is on, deposited SOL and play money never meet in a flip.
        const otherBalance = !!custody?.enabled && !!me && flip.creatorFunded !== me.funded;
        const pending =
          joinMutation.isPending && joinMutation.variables === flip.id
            ? 'join'
            : cancelMutation.isPending && cancelMutation.variables === flip.id
              ? 'cancel'
              : houseMutation.isPending && houseMutation.variables === flip.id
                ? 'house'
                : null;
        return (
          <div
            key={flip.id}
            className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[1fr_110px_130px_minmax(120px,auto)] sm:gap-4 sm:items-center sm:px-5 hover:bg-surface-elevated/30 transition-colors"
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

            {/* Side + amount share a row on phones */}
            <div className="flex items-center justify-between sm:contents">
              <div className="sm:text-center">
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
              <div className="text-right font-mono font-bold text-sm">
                {formatSol(flip.amountLamports, 4)}
              </div>
            </div>

            {/* Actions: watch (everyone) + join, or vs-house/cancel on your own */}
            <div className="flex items-center gap-1.5 sm:justify-end">
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
                <>
                  <button
                    type="button"
                    onClick={() => houseWithModal(flip)}
                    disabled={pending !== null}
                    title="Play this flip against the house now"
                    className="flex flex-1 sm:flex-none items-center justify-center gap-1 rounded-lg border border-primary-400/50 bg-primary-400/10 px-3 py-1.5 text-xs font-bold text-primary-300 hover:bg-primary-400/20 transition-colors disabled:opacity-50"
                  >
                    {pending === 'house' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Landmark className="h-3 w-3" />
                    )}
                    vs House
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => cancelMutation.mutate(flip.id)}
                    disabled={pending !== null}
                    className="flex-1 sm:flex-none text-xs"
                  >
                    {pending === 'cancel' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                    Cancel
                  </Button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => joinWithModal(flip)}
                  disabled={pending === 'join' || otherBalance}
                  title={
                    otherBalance
                      ? flip.creatorFunded
                        ? 'Played with deposited SOL — deposit to join'
                        : 'A play-money flip'
                      : undefined
                  }
                  className="flex flex-1 sm:flex-none items-center justify-center gap-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-50"
                >
                  {pending === 'join' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {otherBalance ? (flip.creatorFunded ? 'SOL only' : 'Play only') : 'Join'}
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
