'use client';

import type { LotterySnapshot } from '@/hooks/use-lottery';

/**
 * PancakeSwap-style bracket prize table, paid in $SCAD. The round pool is split
 * per bracket — match the first N digits (left → right) to win bracket N's
 * slice, shared equally among that bracket's winners. 20% of every pool is
 * burned. Values are driven by the live API snapshot (no cross-package runtime
 * imports in the bundle).
 */
function fmtScad(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : 2 })} SCAD`;
}

export function PrizeTable({ snap }: { snap: LotterySnapshot | null }) {
  const cfg = snap?.config;
  const pool = snap?.totalPoolScad ?? 0;
  const burnBps = cfg?.burnBps ?? 2000;
  const breakdown = cfg?.rewardsBreakdownBps ?? [125, 375, 750, 1250, 2500, 5000];
  const winnerShareFrac = (10_000 - burnBps) / 10_000;

  const rows = breakdown.map((bps, i) => {
    const pctOfTotal = winnerShareFrac * (bps / 10_000); // e.g. 0.01, 0.03 … 0.40
    const slice = pool * pctOfTotal;
    const jackpot = i === breakdown.length - 1;
    return {
      label: jackpot
        ? `Match all ${breakdown.length} — Jackpot`
        : `Match first ${i + 1}`,
      pct: `${(pctOfTotal * 100).toFixed(pctOfTotal * 100 < 1 ? 2 : 0)}%`,
      value: pool > 0 ? fmtScad(slice) : `${(pctOfTotal * 100).toFixed(0)}% of pool`,
      jackpot,
    };
  });

  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-surface-elevated/50"
        >
          <span className={r.jackpot ? 'font-bold text-gradient' : 'text-foreground-muted'}>
            {r.label}
            <span className="ml-1.5 text-[10px] text-foreground-muted/70">({r.pct})</span>
          </span>
          <span
            className={
              r.jackpot ? 'font-mono text-amber-400 font-bold' : 'font-mono text-foreground/80'
            }
          >
            {r.value}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-surface-elevated/50">
        <span className="text-foreground-muted">
          Burned 🔥
          <span className="ml-1.5 text-[10px] text-foreground-muted/70">
            ({(burnBps / 100).toFixed(0)}%)
          </span>
        </span>
        <span className="font-mono text-foreground/60">
          {pool > 0 ? fmtScad((pool * burnBps) / 10_000) : `${(burnBps / 100).toFixed(0)}% of pool`}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-surface-elevated/50">
        <span className="text-foreground-muted">Loyalty — every 1 SOL wagered</span>
        <span className="text-primary-300 text-[11px] font-semibold">1 FREE ticket</span>
      </div>
    </div>
  );
}
