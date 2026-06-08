'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CreateFlipBar } from './create-flip-form';
import { OpenFlipsList } from './open-flips-list';
import { RecentFlipsList } from './recent-flips-list';
import { FlipModal } from './flip-modal';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import type { CoinflipGame } from '@/hooks/use-coinflip';

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
          </div>
          {isAuthenticated ? (
            <CreateFlipBar />
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
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-[1fr_110px_130px_120px] gap-4 px-5 py-3 border-b border-border text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
                  <div>Players</div>
                  <div className="text-center">Side</div>
                  <div className="text-right">Amount</div>
                  <div className="text-right">Action</div>
                </div>
                {tab === 'open' ? (
                  <OpenFlipsList sort={sort} onWatch={watch} />
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
