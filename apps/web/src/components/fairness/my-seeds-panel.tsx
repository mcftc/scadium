'use client';

import { useState } from 'react';
import { Check, Copy, Loader2, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/auth-store';
import {
  useMySeed,
  useSetClientSeed,
  useRotateServerSeed,
  type RotateResult,
} from '@/hooks/use-fairness-seed';
import { ApiError } from '@/lib/api-client';

/**
 * "My seeds" panel (#94): the player's active provably-fair pair. Shows the
 * published server-seed commitments + nonce, lets the player set their own
 * client seed, and rotates the server seed — revealing the old one so every
 * past bet on it becomes verifiable in the form below.
 */
export function MySeedsPanel() {
  const token = useAuthStore((s) => s.accessToken);
  const { data: pair, isLoading, isError, refetch } = useMySeed();
  const setSeed = useSetClientSeed();
  const rotate = useRotateServerSeed();

  const [draft, setDraft] = useState<string | null>(null);
  // The reveal box keeps the PRE-rotation commitment alongside the revealed
  // seed — after rotation the refetched pair already shows the new hashes, and
  // the user needs the old one to check sha256(revealed) against it.
  const [revealed, setRevealed] = useState<(RotateResult & { priorHash: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <p className="text-sm text-foreground-muted">
        Connect your wallet to view and manage your seed pair. Your client seed and nonce drive
        the outcome of your own bets.
      </p>
    );
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger flex items-center justify-between gap-3">
        Couldn&apos;t load your seed pair.
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (isLoading || !pair) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your seed pair…
      </div>
    );
  }

  const clientSeedValue = draft ?? pair.clientSeed;
  const dirty = draft !== null && draft.trim() !== pair.clientSeed;

  async function saveClientSeed() {
    setError(null);
    try {
      await setSeed.mutateAsync(clientSeedValue.trim());
      setDraft(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update client seed');
    }
  }

  async function rotateNow() {
    setError(null);
    const priorHash = pair!.serverSeedHash;
    try {
      setRevealed({ ...(await rotate.mutateAsync()), priorHash });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to rotate server seed');
    }
  }

  return (
    <div className="space-y-5">
      <HashRow label="Active server seed hash (committed)" value={pair.serverSeedHash} />
      <HashRow label="Next server seed hash (pre-committed)" value={pair.nextServerSeedHash} />

      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
            Client seed (yours — 1–64 chars; changing it resets the nonce)
          </div>
          <input
            value={clientSeedValue}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={64}
            className="w-full rounded-xl border border-border bg-surface-elevated px-4 h-11 text-sm font-mono focus:outline-none focus:border-primary-400"
          />
        </div>
        <Button
          onClick={saveClientSeed}
          disabled={!dirty || clientSeedValue.trim().length === 0 || setSeed.isPending}
          className="h-11"
        >
          {setSeed.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-foreground-muted mb-1">Nonce</div>
          <div className="font-mono text-sm">{pair.nonce}</div>
        </div>
        <Button variant="secondary" onClick={rotateNow} disabled={rotate.isPending}>
          {rotate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Rotate server seed
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {revealed && (
        <div className="rounded-xl border border-success/30 bg-success/5 p-5 space-y-3">
          <div className="text-sm font-semibold text-success">
            Server seed revealed — verify your past bets with it
          </div>
          <HashRow label="Revealed server seed" value={revealed.revealedServerSeed} />
          <HashRow label="Its published commitment (pre-rotation)" value={revealed.priorHash} />
          <p className="text-[11px] text-foreground-muted">
            Check that <code>sha256(revealed seed)</code> equals the commitment above — paste
            both into the verifier below. The pre-committed next hash is now your active
            commitment.
          </p>
        </div>
      )}
    </div>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-xl border border-border bg-surface-elevated px-4 py-3 text-xs font-mono break-all">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className={cn(
            'shrink-0 rounded-lg border border-border p-2 transition-colors hover:border-primary-400/40',
            copied && 'text-success border-success/40',
          )}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
