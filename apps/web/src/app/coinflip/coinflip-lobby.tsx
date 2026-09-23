'use client';

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CreateFlipBar } from './create-flip-form';
import { OpenFlipsList } from './open-flips-list';
import { RecentFlipsList } from './recent-flips-list';
import { FlipModal } from './flip-modal';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { HouseEdgeBadge } from '@/components/game/house-edge-badge';
import { subscribeMyFlipJoined, useMyCoinflips, type CoinflipGame } from '@/hooks/use-coinflip';
import { formatSol } from '@/lib/format';

export type FlipSort = 'price' | 'newest';

/**
 * solpump coinflip layout: title + horizontal create bar up top, sort
 * control, then the game table. Watching/joining opens the FlipModal which
 * plays the 3D flip. Chat lives in the global left rail (AppShell).
 */
export function CoinflipLobby() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const [tab, setTab] = useState<'open' | 'recent'>('open');
  const [sort, setSort] = useState<FlipSort>('price');
  const [watched, setWatched] = useState<CoinflipGame | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  function watch(game: CoinflipGame) {
    setWatched(game);
    setModalOpen(true);
  }

  // Someone took my flip while I was looking elsewhere in the lobby: show me
  // the flip instead of letting it silently vanish from the list.
  useEffect(() => subscribeMyFlipJoined(watch), []);

  return (
    <div className="flex gap-4">
      <div className="flex-1 min-w-0">
        {/* Header: title left, create bar right (solpump top bar) */}
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
              Pick a side and flip
            </p>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight">COINFLIP</h1>
            <div className="mt-2">
              <HouseEdgeBadge game="coinflip" />
            </div>
          </div>
          {isAuthenticated ? (
            // A house flip comes back already resolved — play it in the theater.
            <CreateFlipBar onCreated={(g) => g.status === 'completed' && watch(g)} />
          ) : (
            <button
              type="button"
              onClick={() => openWallet()}
              className="self-start rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 h-10 text-sm font-bold text-white transition-colors"
            >
              Connect to flip
            </button>
          )}
        </div>

        {isAuthenticated && <MyOpenFlips onWatch={watch} />}

        {/* List controls: tabs + sort */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground-muted">
              All Games
            </span>
            <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border">
              {(
                [
                  ['open', 'Active'],
                  ['recent', 'Recent'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    tab === key ? 'bg-surface-elevated text-foreground' : 'text-foreground-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground-muted">
            Sort By:
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as FlipSort)}
              className="rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs font-semibold outline-none [&>option]:bg-surface"
            >
              <option value="price">Highest Price</option>
              <option value="newest">Newest</option>
            </select>
          </label>
        </div>

        {/* Game list */}
        <Card>
          <CardContent className="p-0">
            <div>
              <div>
                <div className="hidden sm:grid grid-cols-[1fr_110px_130px_minmax(120px,auto)] gap-4 px-5 py-3 border-b border-border text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
                  <div>Players</div>
                  <div className="text-center">Side</div>
                  <div className="text-right">Amount</div>
                  <div className="text-right">Action</div>
                </div>
                {tab === 'open' ? (
                  <OpenFlipsList
                    sort={sort}
                    onWatch={watch}
                    onJoinFailed={() => setModalOpen(false)}
                  />
                ) : (
                  <RecentFlipsList sort={sort} onWatch={watch} />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <FlipModal game={watched} open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

/**
 * The player's own open flips — their locked stakes — whether or not they are
 * among the newest the lobby shows, with how long each has before it expires.
 */
function MyOpenFlips({ onWatch }: { onWatch: (game: CoinflipGame) => void }) {
  const { data } = useMyCoinflips();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!data || data.length === 0) return null;
  const locked = data.reduce((sum, g) => sum + BigInt(g.amountLamports), BigInt(0));
  return (
    <div className="mb-4 rounded-xl border border-primary-400/30 bg-primary-400/5 px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <Lock className="h-3.5 w-3.5 text-primary-400" />
        Your open flips · {formatSol(locked.toString(), 4)} SOL locked
      </div>
      <div className="flex flex-wrap gap-2">
        {data.map((g) => {
          const mins = g.expiresAt
            ? Math.max(0, Math.ceil((Date.parse(g.expiresAt) - now) / 60_000))
            : null;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onWatch(g)}
              className="rounded-lg border border-border bg-surface-elevated/60 px-2.5 py-1.5 text-[11px] hover:border-primary-400/40 transition-colors"
            >
              <span className="font-mono font-semibold">{formatSol(g.amountLamports, 4)}</span>{' '}
              <span className="uppercase text-foreground-muted">{g.creatorSide}</span>
              {mins !== null && <span className="text-foreground-muted"> · refund in {mins}m</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
