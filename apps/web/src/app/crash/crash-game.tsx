'use client';

import { Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CrashCurve } from './crash-curve';
import { CrashBetPanel } from './crash-bet-panel';
import { CrashPlayersList } from './crash-players-list';
import { CrashHistory } from './crash-history';
import { CrashFairness } from './crash-fairness';
import { useCrash } from '@/hooks/use-crash';
import { useMe } from '@/hooks/use-me';

/**
 * solpump layout: game center (full immersion), bet panel + players RIGHT.
 * Chat lives in the global left rail (AppShell), not in this component.
 */
export function CrashGame() {
  const { state, cashouts } = useCrash();
  const { data: me } = useMe();
  const myBet = state?.bets.find((b) => b.userId === me?.id) ?? null;

  return (
    <div className="flex gap-4">
      {/* CENTER: Game area */}
      <div className="flex-1 min-w-0 space-y-3">
        <CrashHistory history={state?.history ?? []} />
        <div className="relative rounded-2xl overflow-hidden border border-border/50 aspect-[16/9] lg:aspect-auto lg:h-[520px]">
          <CrashCurve state={state} cashouts={cashouts} myBet={myBet} />
          {/* Live player count overlay (top-left), like solpump */}
          <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 backdrop-blur-sm border border-white/10">
            <Users className="h-3 w-3 text-cyan-300" />
            <span className="text-[11px] font-semibold text-white/90 tabular-nums">
              {state?.bets.length ?? 0}
            </span>
            <span className="text-[10px] text-white/50">Playing</span>
          </div>
        </div>
      </div>

      {/* RIGHT: Bet panel + players */}
      <div className="hidden lg:block w-[300px] shrink-0 pr-4 sm:pr-6 lg:pr-8 space-y-4">
        <Card className="p-5">
          <CrashBetPanel state={state} />
        </Card>
        <Card className="p-4 max-h-[380px] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
              Live bets
            </h3>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-foreground-muted">
              <Users className="h-3 w-3" />
              {state?.bets.length ?? 0} Playing
            </span>
          </div>
          <CrashPlayersList bets={state?.bets ?? []} />
        </Card>
        <CrashFairness state={state} />
      </div>
    </div>
  );
}
