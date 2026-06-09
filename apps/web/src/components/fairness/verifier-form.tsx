'use client';

import { useEffect, useState } from 'react';
import { Check, X, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  crashPoint,
  coinflipResult,
  blackjackDeal,
  lotteryDraw,
  jackpotRoll,
  verifyCommit,
} from '@/lib/fair-browser';

type Game = 'crash' | 'coinflip' | 'blackjack' | 'lottery' | 'jackpot';

interface Result {
  game: Game;
  output: string;
  commitOk: boolean | null;
}

/**
 * Client-side verifier. Uses WebCrypto directly — the server never sees
 * the seeds, the computation is auditable, and any mismatch is the user's
 * proof that something was tampered with.
 */
export function VerifierForm() {
  const [game, setGame] = useState<Game>('crash');
  const [serverSeed, setServerSeed] = useState('');
  const [clientSeed, setClientSeed] = useState('');
  const [nonce, setNonce] = useState('0');
  const [commitHash, setCommitHash] = useState('');
  const [slotHash, setSlotHash] = useState(''); // lottery only — draw-time entropy
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefill from a deep link, e.g. the crash "Verify this round" button:
  // /fairness?game=crash&clientSeed=…&nonce=…&commit=…&serverSeed=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const g = q.get('game');
    if (g === 'crash' || g === 'coinflip' || g === 'blackjack' || g === 'lottery' || g === 'jackpot')
      setGame(g);
    const ss = q.get('serverSeed');
    const cs = q.get('clientSeed');
    const n = q.get('nonce');
    const commit = q.get('commit');
    const sh = q.get('slotHash');
    if (ss) setServerSeed(ss);
    if (cs) setClientSeed(cs);
    if (n) setNonce(n);
    if (commit) setCommitHash(commit);
    if (sh) setSlotHash(sh);
  }, []);

  async function compute() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      if (!serverSeed || !clientSeed) {
        throw new Error('Both serverSeed and clientSeed are required');
      }
      const nonceNum = parseInt(nonce, 10);
      if (!Number.isFinite(nonceNum) || nonceNum < 0) {
        throw new Error('Nonce must be a non-negative integer');
      }

      let output = '';
      if (game === 'crash') {
        const p = await crashPoint(serverSeed, clientSeed, nonceNum);
        output = `${p.toFixed(2)}×`;
      } else if (game === 'coinflip') {
        const r = await coinflipResult(serverSeed, clientSeed, nonceNum);
        output = r;
      } else if (game === 'lottery') {
        if (!slotHash.trim()) {
          throw new Error('Lottery needs the draw’s slot hash (64 hex chars) — shown on the lottery page after each draw');
        }
        const { digits } = await lotteryDraw(serverSeed, clientSeed, slotHash.trim(), nonceNum);
        output = digits.join('  ');
      } else if (game === 'jackpot') {
        const roll = await jackpotRoll(serverSeed, clientSeed, nonceNum);
        output = `roll ${roll}  (winner = roll mod pot)`;
      } else {
        const cards = await blackjackDeal(serverSeed, clientSeed, nonceNum, 10);
        output = cards.map((c) => `${c.rank}${c.suit}`).join(' ');
      }

      const commitOk = commitHash.trim()
        ? await verifyCommit(serverSeed, commitHash.trim())
        : null;

      setResult({ game, output, commitOk });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">Game</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(['crash', 'coinflip', 'blackjack', 'lottery', 'jackpot'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                setGame(g);
                setResult(null);
              }}
              className={cn(
                'py-2 rounded-lg border text-sm font-semibold capitalize transition-colors',
                game === g
                  ? 'border-primary-400 bg-primary-400/10 text-primary-400'
                  : 'border-border bg-surface-elevated text-foreground-muted hover:border-primary-400/30',
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <TextField
        label="Server seed (revealed after round)"
        value={serverSeed}
        onChange={setServerSeed}
        placeholder="64-char hex"
        mono
      />
      <TextField
        label="Client seed"
        value={clientSeed}
        onChange={setClientSeed}
        placeholder="client-chosen entropy"
        mono
      />
      <TextField
        label="Nonce"
        value={nonce}
        onChange={setNonce}
        placeholder="0"
        mono
      />
      {game === 'lottery' && (
        <TextField
          label="Slot hash (draw-time entropy — from the draw / reveal tx)"
          value={slotHash}
          onChange={setSlotHash}
          placeholder="64-char hex"
          mono
        />
      )}
      <TextField
        label="Server seed hash (optional — verifies the commitment)"
        value={commitHash}
        onChange={setCommitHash}
        placeholder="sha256 of serverSeed, published before the round"
        mono
      />

      <Button onClick={compute} size="lg" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
        Verify
      </Button>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-border bg-surface-elevated p-5 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
              {result.game} result
            </div>
            <div className="text-2xl font-bold font-mono break-all text-gradient">
              {result.output}
            </div>
          </div>
          {result.commitOk !== null && (
            <div
              className={cn(
                'flex items-center gap-2 text-sm border-t border-border pt-3',
                result.commitOk ? 'text-success' : 'text-danger',
              )}
            >
              {result.commitOk ? (
                <>
                  <Check className="h-4 w-4" />
                  Commit matches — the server didn&apos;t swap seeds
                </>
              ) : (
                <>
                  <X className="h-4 w-4" />
                  Commit mismatch — seed was tampered with
                </>
              )}
            </div>
          )}
          <p className="text-[11px] text-foreground-muted border-t border-border pt-3">
            Computed locally in your browser via WebCrypto HMAC-SHA256. Nothing was sent to the
            server.
          </p>
        </div>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-xl border border-border bg-surface-elevated px-4 h-11 text-sm focus:outline-none focus:border-primary-400',
          mono && 'font-mono',
        )}
      />
    </div>
  );
}
