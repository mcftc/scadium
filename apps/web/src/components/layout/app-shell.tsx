'use client';

import { useEffect } from 'react';
import { Activity, ChevronsLeft, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useLayoutStore } from '@/store/layout-store';
import { captureRef } from '@/lib/ref-capture';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { BottomNav } from '@/components/layout/bottom-nav';
import { ChatPanel } from '@/components/chat/chat-panel';
import { AirdropWidget } from '@/components/airdrop/airdrop-widget';
import { AgeGate } from '@/components/compliance/age-gate';
import { LegalGate } from '@/components/compliance/legal-gate';
import { CookieBanner } from '@/components/compliance/cookie-banner';
import { MaintenanceBanner } from '@/components/layout/maintenance-banner';
import { CustodyBanner } from '@/components/layout/custody-banner';
import { LiveBetTicker } from '@/components/layout/live-bet-ticker';
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
  const railOpen = useLayoutStore((s) => s.railOpen);
  const setRailOpen = useLayoutStore((s) => s.setRailOpen);

  // Capture an affiliate ?ref code on first visit so sign-in can attribute it (#47).
  useEffect(() => {
    captureRef(window.location.search);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <AgeGate />
      <LegalGate />
      <CookieBanner />
      <MaintenanceBanner />
      <CustodyBanner />
      <Header />
      <LiveBetTicker />
      <div className="flex flex-1 min-h-0">
        {/* Collapsible on desktop (solpump-style): the rail slides away and a
            small chat tab at the bottom-left brings it back. */}
        <aside
          className={cn(
            'w-0 shrink-0 border-border/50 transition-[width] duration-300 ease-out',
            railOpen ? 'lg:w-72 lg:border-r lg:bg-surface/30' : 'lg:w-0 lg:overflow-hidden',
          )}
        >
          <div className="relative lg:sticky lg:top-14 flex max-lg:h-0 lg:h-[calc(100vh-3.5rem)] lg:w-72 flex-col">
            <div className="hidden lg:block p-3 pb-0">
              <AirdropWidget />
            </div>
            <div className="min-h-0 flex-1 lg:p-3">
              <ChatPanel />
            </div>
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              aria-label="Hide chat"
              title="Hide chat"
              className="absolute -right-3 top-1/2 z-10 hidden h-12 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-border/60 bg-surface text-foreground-muted hover:text-foreground lg:flex"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
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

        {!railOpen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            aria-label="Show chat"
            title="Show chat"
            className="fixed bottom-6 left-0 z-40 hidden h-11 w-12 items-center justify-center rounded-r-xl border border-l-0 border-border bg-surface text-foreground-muted shadow-lg hover:text-foreground lg:flex"
          >
            <MessageSquare className="h-5 w-5" />
          </button>
        )}

        {/* pb-16 keeps page content clear of the fixed mobile bottom nav. */}
        <main className="min-w-0 flex-1 pb-16 lg:pb-0">{children}</main>
      </div>
      <BottomNav />
      <Footer />
    </div>
  );
}
