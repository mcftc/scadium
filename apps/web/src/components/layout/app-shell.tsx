'use client';

import { Activity } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { ChatPanel } from '@/components/chat/chat-panel';
import { AirdropWidget } from '@/components/airdrop/airdrop-widget';
import { usePlatformLive } from '@/hooks/use-platform';

/**
 * Global page shell (solpump layout): sticky header on top, a persistent
 * left rail (airdrop pool + community chat + total-bets ticker) on desktop,
 * and the routed page content to its right.
 *
 * The ChatPanel is mounted ONCE (it owns a websocket): on lg+ it fills the
 * rail; below lg the rail collapses to zero width and the panel's own
 * fixed-position float button/drawer takes over (position:fixed escapes the
 * zero-width parent).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: live } = usePlatformLive();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1 min-h-0">
        <aside className="w-0 lg:w-72 shrink-0 lg:border-r border-border/50 lg:bg-surface/30">
          <div className="lg:sticky lg:top-14 flex max-lg:h-0 lg:h-[calc(100vh-3.5rem)] flex-col">
            <div className="hidden lg:block p-3 pb-0">
              <AirdropWidget />
            </div>
            <div className="min-h-0 flex-1 lg:p-3">
              <ChatPanel />
            </div>
            <div className="hidden lg:flex items-center justify-between border-t border-border/50 px-4 py-2">
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foreground-muted">
                <Activity className="h-3 w-3 text-primary-400" />
                Total Bets
              </span>
              <span className="font-mono text-xs font-bold tabular-nums">
                {live ? live.totalBets.toLocaleString() : '—'}
              </span>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <Footer />
    </div>
  );
}
