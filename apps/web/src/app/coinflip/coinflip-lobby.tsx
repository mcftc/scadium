'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CreateFlipForm } from './create-flip-form';
import { OpenFlipsList } from './open-flips-list';
import { RecentFlipsList } from './recent-flips-list';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { Button } from '@/components/ui/button';
import { Wallet, Plus } from 'lucide-react';
import { ChatPanel } from '@/components/chat/chat-panel';

/**
 * Solpump-inspired coinflip layout:
 * - Chat LEFT sidebar
 * - Center: title bar with stats + "Create Flip" CTA + tabs + game rows
 * - No separate column for create form — it's a modal/inline expansion
 */
export function CoinflipLobby() {
  const { isAuthenticated } = useWalletAuth();
  const { open } = useWalletModal();
  const [tab, setTab] = useState<'open' | 'recent'>('open');
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex gap-4 -mx-4 sm:-mx-6 lg:-mx-8">
      {/* LEFT: Chat */}
      <div className="hidden lg:block w-[300px] shrink-0 pl-4 sm:pl-6 lg:pl-8">
        <div className="sticky top-20 h-[calc(100vh-6rem)] rounded-2xl border border-border bg-surface/60 backdrop-blur-xl overflow-hidden">
          <ChatPanel defaultOpen />
        </div>
      </div>

      {/* CENTER: Main content */}
      <div className="flex-1 min-w-0 pr-4 sm:pr-6 lg:pr-8">
        {/* Header bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
              Play coinflip instantly with Solana — no KYC needed
            </p>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight">COINFLIP</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Tab toggles */}
            <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setTab('open')}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  tab === 'open' ? 'bg-surface-elevated text-foreground' : 'text-foreground-muted'
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setTab('recent')}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  tab === 'recent'
                    ? 'bg-surface-elevated text-foreground'
                    : 'text-foreground-muted'
                }`}
              >
                Recent
              </button>
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                if (!isAuthenticated) return open();
                setShowCreate(!showCreate);
              }}
            >
              <Plus className="h-4 w-4" />
              Create Flip
            </Button>
          </div>
        </div>

        {/* Inline create form (expands) */}
        {showCreate && isAuthenticated && (
          <Card className="mb-6">
            <CardContent className="p-5">
              <CreateFlipForm onCreated={() => setShowCreate(false)} />
            </CardContent>
          </Card>
        )}

        {/* Game list */}
        <Card>
          <CardContent className="p-0">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_120px_140px_100px] gap-4 px-5 py-3 border-b border-border text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
              <div>Players</div>
              <div className="text-center">Side</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Action</div>
            </div>
            {tab === 'open' ? <OpenFlipsList /> : <RecentFlipsList />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
