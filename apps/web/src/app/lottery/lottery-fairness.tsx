'use client';

import Link from 'next/link';
import { ShieldCheck, ExternalLink, Lock, Unlock } from 'lucide-react';
import type { LotterySnapshot } from '@/hooks/use-lottery';

/**
 * Provably-fair disclosure for the current lottery draw. The winning numbers
 * are committed (sha256(serverSeed)) the instant the draw opens and only the
 * commitment is public while tickets sell — the seed for the *previous* draw is
 * revealed so anyone can reproduce its result in the /fairness verifier.
 */
export function LotteryFairness({ snap }: { snap: LotterySnapshot | null }) {
  if (!snap) return null;
  const last = snap.lastResult;
  const verifyHref = last
    ? `/fairness?game=lottery&clientSeed=${encodeURIComponent(last.clientSeed)}` +
      `&nonce=${last.nonce}&commit=${last.serverSeedHash}&serverSeed=${last.serverSeed}`
    : '/fairness';

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          Provably Fair
        </h3>
        <span className="flex items-center gap-1 text-[10px] font-semibold text-foreground-muted">
          <Lock className="h-3 w-3" />
          This draw committed
        </span>
      </div>

      <SeedRow label="Current draw — server seed (commit)" value={snap.serverSeedHash} />
      <SeedRow label="Client seed" value={snap.clientSeed} />

      {last && (
        <div className="pt-2 border-t border-border space-y-2">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-success">
            <Unlock className="h-3 w-3" />
            Previous draw revealed
          </div>
          <SeedRow label="Server seed (revealed)" value={last.serverSeed} />
          <Link
            href={verifyHref}
            className="flex items-center justify-center gap-1.5 w-full rounded-lg border border-primary-400/40 bg-primary-400/10 py-2 text-xs font-semibold text-primary-400 hover:bg-primary-400/20 transition-colors"
          >
            Verify previous draw
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function SeedRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-foreground-muted/70 mb-0.5">
        {label}
      </div>
      <div className="font-mono text-[10px] break-all leading-tight text-foreground/90">{value}</div>
    </div>
  );
}
