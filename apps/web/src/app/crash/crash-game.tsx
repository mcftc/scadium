'use client';

import { Card } from '@/components/ui/card';
import { ChatPanel } from '@/components/chat/chat-panel';
import { CrashCurve } from './crash-curve';
import { CrashBetPanel } from './crash-bet-panel';
import { CrashPlayersList } from './crash-players-list';
import { CrashHistory } from './crash-history';
import { useCrash } from '@/hooks/use-crash';

/**
 * Solpump-inspired layout: chat LEFT, game center (full immersion), bet
 * panel + players RIGHT. The crash visualization takes the lion's share
 * of the viewport for maximum visual impact.
 */
export function CrashGame() {
  const { state } = useCrash();

  return (
    <div className="flex gap-4 -mx-4 sm:-mx-6 lg:-mx-8">
      {/* LEFT: Chat */}
      <div className="hidden lg:block w-[300px] shrink-0 pl-4 sm:pl-6 lg:pl-8">
        <div className="sticky top-20 h-[calc(100vh-6rem)] rounded-2xl border border-border bg-surface/60 backdrop-blur-xl overflow-hidden">
          <ChatPanel defaultOpen />
        </div>
      </div>

      {/* CENTER: Game area */}
      <div className="flex-1 min-w-0 space-y-3">
        <CrashHistory history={state?.history ?? []} />
        <div className="relative rounded-2xl overflow-hidden border border-border/50 aspect-[16/9] lg:aspect-auto lg:h-[520px]">
          <CrashCurve state={state} />
        </div>
      </div>

      {/* RIGHT: Bet panel + players */}
      <div className="hidden lg:block w-[300px] shrink-0 pr-4 sm:pr-6 lg:pr-8 space-y-4">
        <Card className="p-5">
          <CrashBetPanel state={state} />
        </Card>
        <Card className="p-4 max-h-[380px] overflow-y-auto">
          <h3 className="text-[10px] uppercase tracking-wider text-foreground-muted mb-3 font-semibold">
            Live bets
          </h3>
          <CrashPlayersList bets={state?.bets ?? []} />
        </Card>
      </div>
    </div>
  );
}
