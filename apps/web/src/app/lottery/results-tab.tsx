'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ExternalLink, Star } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { formatUsd } from '@/lib/format';
import { useDrawResults, useRecentDraws } from '@/hooks/use-lottery';
import { LotteryBalls } from './lottery-balls';
import { PlayerCell } from './player-cell';

/**
 * bc.game Results tab: game-number navigation, the round's winning numbers
 * with sale/winner tallies, and the public Winners List.
 */
export function ResultsTab() {
  const recent = useRecentDraws(100);
  const draws = (recent.data ?? []).filter((d) => d.drawIndex !== null);
  const [selected, setSelected] = useState<string | null>(null);

  // Default to the most recent settled round once the list arrives.
  useEffect(() => {
    if (selected === null && draws.length > 0) setSelected(draws[0]!.drawIndex);
  }, [selected, draws]);

  const pos = draws.findIndex((d) => d.drawIndex === selected);
  const results = useDrawResults(selected);
  const r = results.data;

  if (recent.isLoading) {
    return <div className="py-10 text-center text-xs text-foreground-muted">Loading…</div>;
  }
  if (draws.length === 0) {
    return (
      <Card className="p-10 text-center text-xs text-foreground-muted">
        No settled draws yet — results appear here after the first draw.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Game number navigation: ‹ [dropdown] › (newest first, prev = older). */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-foreground-muted">Game number</span>
        <div className="flex items-center rounded-xl border border-border bg-surface-elevated overflow-hidden">
          <button
            type="button"
            disabled={pos < 0 || pos >= draws.length - 1}
            onClick={() => setSelected(draws[pos + 1]!.drawIndex)}
            className="px-2 py-2 text-foreground-muted hover:text-foreground disabled:opacity-40"
            aria-label="Older draw"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            className="bg-transparent text-sm font-mono font-bold outline-none px-1 py-2 [&>option]:bg-surface"
            aria-label="Select draw"
          >
            {draws.map((d) => (
              <option key={d.id} value={d.drawIndex!}>
                {d.gameNumber}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pos <= 0}
            onClick={() => setSelected(draws[pos - 1]!.drawIndex)}
            className="px-2 py-2 text-foreground-muted hover:text-foreground disabled:opacity-40"
            aria-label="Newer draw"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {results.isLoading || !r ? (
        <div className="py-10 text-center text-xs text-foreground-muted">Loading…</div>
      ) : (
        <>
          {/* Winning numbers banner (bc.game green ticket strip). */}
          <Card className="p-5 border-success/30 bg-success/5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="text-[11px] text-foreground-muted">
                  Draw time:{' '}
                  <span className="text-foreground font-semibold">
                    {r.drawnAt ? new Date(r.drawnAt).toLocaleString([], { hour12: false }) : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs font-bold text-success">
                  <Star className="h-3.5 w-3.5" />
                  Winning Numbers
                  <Star className="h-3.5 w-3.5" />
                </div>
                {r.mainNumbers.length > 0 ? (
                  <LotteryBalls main={r.mainNumbers} bonus={r.bonusNumber} />
                ) : (
                  <span className="text-xs text-foreground-muted">Not drawn yet</span>
                )}
              </div>
              <div className="space-y-1.5 text-right">
                <div className="text-[11px] text-foreground-muted">
                  Total tickets sold in this round:{' '}
                  <span className="font-mono font-bold text-foreground">{r.ticketCount}</span>
                </div>
                <div className="text-[11px] text-foreground-muted">
                  Winning tickets in this round:{' '}
                  <span className="font-mono font-bold text-success">{r.winnersCount}</span>
                </div>
                <Link
                  href={
                    `/fairness?game=lottery&clientSeed=${encodeURIComponent(r.clientSeed)}` +
                    `&nonce=${r.nonce}&commit=${r.serverSeedHash}` +
                    (r.serverSeed ? `&serverSeed=${r.serverSeed}` : '') +
                    (r.slotHash ? `&slotHash=${r.slotHash}` : '')
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Verify draw
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </Card>

          {/* Winners list (bc.game table: Player | Numbers | Matches | Profit). */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-center gap-2 text-xs font-bold">
              <Star className="h-3.5 w-3.5 text-amber-400" />
              Winners List
              <Star className="h-3.5 w-3.5 text-amber-400" />
            </div>
            {r.winners.length === 0 ? (
              <div className="py-8 text-center text-xs text-foreground-muted">
                No winning tickets this round.
              </div>
            ) : (
              <div className="space-y-1">
                <div className="hidden sm:grid grid-cols-[1fr_auto_70px_90px] gap-3 px-3 pb-2 text-[10px] uppercase tracking-wider text-foreground-muted">
                  <span>Player</span>
                  <span>Numbers</span>
                  <span className="text-center">Matches</span>
                  <span className="text-right">Profit</span>
                </div>
                {r.winners.map((w, i) => (
                  <div
                    key={i}
                    className="grid sm:grid-cols-[1fr_auto_70px_90px] grid-cols-1 gap-2 sm:gap-3 items-center rounded-lg bg-surface-elevated/40 px-3 py-2"
                  >
                    <PlayerCell player={w.player} />
                    <LotteryBalls
                      main={w.mainNumbers}
                      bonus={w.bonusNumber}
                      hits={r.mainNumbers}
                      bonusHit={w.matchedBonus > 0}
                      size="sm"
                    />
                    <span className="text-xs font-mono sm:text-center">
                      {w.matchedMain}
                      {w.matchedBonus > 0 ? ' + bonus' : ''}
                    </span>
                    <span className="text-xs font-mono font-bold text-success sm:text-right">
                      {formatUsd(w.payoutUsd)}
                    </span>
                  </div>
                ))}
                {r.winnersCount > r.winners.length && (
                  <p className="pt-2 text-center text-[10px] text-foreground-muted">
                    Top {r.winners.length} of {r.winnersCount} winning tickets shown.
                  </p>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
