'use client';

import Link from 'next/link';
import { ShieldCheck, ExternalLink, Lock, Unlock } from 'lucide-react';
import type { CrashSnapshot } from '@/hooks/use-crash';

/**
 * Per-round provably-fair disclosure for crash. Shows the up-front commitment
 * (`sha256(serverSeed)`), the public clientSeed + nonce, and — once the round
 * busts — the revealed serverSeed, plus a deep link into the /fairness verifier
 * pre-filled with this round's inputs so anyone can reproduce the bust point.
 */
export function CrashFairness({ state }: { state: CrashSnapshot | null }) {
  if (!state) return null;

  const revealed = state.phase === 'busted' && !!state.serverSeed;
  const verifyHref =
    `/fairness?game=crash&clientSeed=${encodeURIComponent(state.clientSeed)}` +
    `&nonce=${state.nonce}&commit=${state.serverSeedHash}` +
    (revealed ? `&serverSeed=${state.serverSeed}` : '');

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
          {revealed ? 'Revealed' : 'Committed'}
        </span>
      </div>

      <SeedRow label="Server seed (SHA-256 commit)" value={state.serverSeedHash} />
      <SeedRow label="Client seed" value={state.clientSeed} />
      <SeedRow label="Nonce" value={String(state.nonce)} />
      <SeedRow
        label="Server seed (revealed)"
        value={revealed ? state.serverSeed! : '— revealed after bust —'}
        muted={!revealed}
      />

      <Link
        href={verifyHref}
        className="flex items-center justify-center gap-1.5 w-full rounded-lg border border-primary-400/40 bg-primary-400/10 py-2 text-xs font-semibold text-primary-400 hover:bg-primary-400/20 transition-colors"
      >
        Verify this round
        <ExternalLink className="h-3 w-3" />
      </Link>
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
