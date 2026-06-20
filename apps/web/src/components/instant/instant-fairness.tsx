'use client';

import Link from 'next/link';
import { ShieldCheck, ExternalLink, Lock, Unlock } from 'lucide-react';
import { fairnessHref, type InstantSettleResult } from '@/hooks/use-instant-game';

/**
 * Per-round provably-fair disclosure for the instant games. Mirrors
 * crash-fairness: shows the up-front `sha256(serverSeed)` commitment, the public
 * clientSeed + nonce from the last settled round, and a deep link into the
 * /fairness verifier pre-filled with this round's inputs.
 */
export function InstantFairness({
  game,
  last,
}: {
  game: string;
  last: InstantSettleResult | null;
}) {
  const f = last?.fairness;
  const revealed = !!f; // server seed rotates per round; the hash is the commit.

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          Provably Fair
        </h3>
        <span
          className={`flex items-center gap-1 text-[10px] font-semibold ${
            revealed ? 'text-success' : 'text-foreground-muted'
          }`}
        >
          {revealed ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {revealed ? 'Committed' : 'Awaiting bet'}
        </span>
      </div>

      <SeedRow
        label="Server seed (SHA-256 commit)"
        value={f?.serverSeedHash ?? '— place a bet to reveal —'}
        muted={!f}
      />
      <SeedRow label="Client seed" value={f?.clientSeed ?? '—'} muted={!f} />
      <SeedRow label="Nonce" value={f ? String(f.nonce) : '—'} muted={!f} />

      {f ? (
        <Link
          href={fairnessHref(game, f)}
          className="flex items-center justify-center gap-1.5 w-full rounded-lg border border-primary-400/40 bg-primary-400/10 py-2 text-xs font-semibold text-primary-400 hover:bg-primary-400/20 transition-colors"
        >
          Verify this round
          <ExternalLink className="h-3 w-3" />
        </Link>
      ) : (
        <p className="text-[11px] text-foreground-muted text-center">
          Each bet commits a hashed server seed up-front.
        </p>
      )}
    </div>
  );
}

function SeedRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-foreground-muted/70 mb-0.5">
        {label}
      </div>
      <div
        className={`font-mono text-[10px] break-all leading-tight ${
          muted ? 'text-foreground-muted/50 italic' : 'text-foreground/90'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
