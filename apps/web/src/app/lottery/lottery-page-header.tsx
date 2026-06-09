'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock, HelpCircle, ShieldCheck, Ticket, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import type { useLottery } from '@/hooks/use-lottery';
import { LotteryBalls } from './lottery-balls';

function fmtScad(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : 2 })} SCAD`;
}

/**
 * bc.game-style page header: next draw time + 00d:01h:29m:08s countdown,
 * "Latest Winning Prize" banner, pot/ticket stats, last result balls, and the
 * Provably fair / How to play? / My Bets actions.
 */
export function LotteryPageHeader({ snap }: { snap: ReturnType<typeof useLottery> }) {
  const [remaining, setRemaining] = useState(0);
  const [howToOpen, setHowToOpen] = useState(false);

  useEffect(() => {
    if (!snap) return;
    const update = () => setRemaining(Math.max(0, snap.drawAt - Date.now()));
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [snap?.drawAt, snap]);

  // bc.game countdown format: 00d:01h:29m:08s
  const countdown = useMemo(() => {
    const s = Math.ceil(remaining / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d)}d:${p(h)}h:${p(m)}m:${p(sec)}s`;
  }, [remaining]);

  // Wall-clock time of the draw, from the API snapshot (the client bundle
  // can't import runtime values from @scadium/shared).
  const drawTime = useMemo(
    () => (snap ? new Date(snap.drawAt).toLocaleString([], { hour12: false }) : null),
    [snap],
  );

  return (
    <Card className="p-5 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-primary-400/10 via-transparent to-amber-400/5 pointer-events-none" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] text-foreground-muted">
            Next draw time: <span className="text-foreground font-semibold">{drawTime ?? '—'}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary-400" />
            <span className="text-3xl font-black font-mono tabular-nums">
              {snap ? countdown : '—'}
            </span>
          </div>
          <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-success/10 border border-success/30 px-2.5 py-1">
            <span className="text-[10px] uppercase tracking-wider text-foreground-muted">
              Latest Winning Prize
            </span>
            <span className="text-sm font-bold font-mono text-success">
              {snap ? fmtScad(snap.latestWinningPrizeScad) : '—'}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            <Link
              href="/fairness"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] font-semibold text-foreground-muted hover:text-foreground hover:border-primary-400/50 transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-primary-400" />
              Provably fair
            </Link>
            <button
              type="button"
              onClick={() => setHowToOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] font-semibold text-foreground-muted hover:text-foreground hover:border-primary-400/50 transition-colors"
            >
              <HelpCircle className="h-3.5 w-3.5 text-primary-400" />
              How to play?
            </button>
            <Link
              href="/lottery/bets"
              className="flex items-center gap-1.5 rounded-lg border border-primary-400/50 bg-primary-400/10 px-2.5 py-1.5 text-[11px] font-bold text-primary-300 hover:bg-primary-400/20 transition-colors"
            >
              <Ticket className="h-3.5 w-3.5" />
              My Bets
            </Link>
          </div>
          <div className="flex items-center gap-6">
            <Stat label="Pot" value={snap ? fmtScad(snap.totalPoolScad) : '—'} />
            <Stat
              label="Tickets"
              value={snap ? String(snap.ticketCount) : '—'}
              icon={<Users className="h-3 w-3" />}
            />
          </div>
        </div>
      </div>

      {snap?.lastResult && (
        <div className="relative mt-4 pt-4 border-t border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
            Last draw
          </div>
          <LotteryBalls digits={snap.lastResult.digits} size="sm" />
          <div className="text-[10px] text-foreground-muted">
            {snap.lastResult.winnersCount} winner{snap.lastResult.winnersCount === 1 ? '' : 's'}
          </div>
        </div>
      )}

      <Dialog
        open={howToOpen}
        onClose={() => setHowToOpen(false)}
        title="How to play?"
        description="Scadium Lottery — 6-digit · match left-to-right · $SCAD."
      >
        <ol className="list-decimal space-y-2 pl-4 text-sm text-foreground-muted">
          <li>
            Pick a <span className="text-foreground font-semibold">6-digit number</span> (each digit
            0–9) on each ticket — or hit Quick Pick.
          </li>
          <li>
            Each ticket is paid in <span className="text-foreground font-semibold">$SCAD</span> from
            your wallet, with a bulk discount the more you buy. Buy as many as you like — beyond the
            manual cards the rest are random quick-picks.
          </li>
          <li>Draws run every 8 hours at 04:00, 12:00 and 20:00 (UTC+3).</li>
          <li>
            Match your digits to the winning number{' '}
            <span className="text-foreground font-semibold">left-to-right</span> — the more leading
            digits match, the higher your bracket. Match all 6 for the{' '}
            <span className="text-success font-semibold">jackpot</span>. The pooled $SCAD prize is
            split per bracket, shared among that bracket&apos;s winners.
          </li>
          <li>
            Every draw is committed before tickets open and revealed on-chain with Solana slot-hash
            entropy — verify any result yourself on the Provably Fair page.
          </li>
        </ol>
      </Dialog>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="text-right">
      <div className="flex items-center gap-1 justify-end text-[10px] uppercase tracking-wider text-foreground-muted mb-1">
        {icon}
        {label}
      </div>
      <div className="text-lg font-bold font-mono tabular-nums">{value}</div>
    </div>
  );
}
