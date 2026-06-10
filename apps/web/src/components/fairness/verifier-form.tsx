'use client';

import { useEffect, useState } from 'react';
import { Check, X, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  crashPoint,
  coinflipResult,
  reproduceHand,
  reproduceRound,
  lotteryDraw,
  jackpotRoll,
  verifyCommit,
  type DealLogEntry,
} from '@/lib/fair-browser';
import type { Card } from '@scadium/shared';

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
  const [dealLog, setDealLog] = useState(''); // blackjack only — round deal order / seat deck indices
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
        output = await verifyBlackjack(serverSeed, clientSeed, nonceNum, dealLog);
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
          label="Slot hash — pinned at commit (the target slot's hash, from the reveal tx)"
          value={slotHash}
          onChange={setSlotHash}
          placeholder="64-char hex"
          mono
        />
      )}
      {game === 'lottery' && (
        <p className="-mt-2 text-[11px] text-foreground-muted">
          The draw entropy is the hash of a slot <strong>pinned at commit time</strong>, so the
          operator can&apos;t grind the reveal. Draws marked{' '}
          <span className="text-danger">synthetic-not-fair</span> used an off-chain fallback (chain
          disabled) and are <strong>not</strong> provably fair.
        </p>
      )}
      {game === 'blackjack' && (
        <div>
          <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
            Deal log (the round&apos;s deal order, or your seat&apos;s deck indices)
          </div>
          <textarea
            value={dealLog}
            onChange={(e) => setDealLog(e.target.value)}
            placeholder={
              'Round deal log: [{"deckIndex":0,"dealtTo":0,"handId":"seat-0-0"}, …]\n' +
              'or just your seat deck indices: [0,3,6]'
            }
            rows={5}
            className="w-full rounded-xl border border-border bg-surface-elevated px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-primary-400"
          />
          <p className="mt-1 text-[11px] text-foreground-muted">
            A busy table deals more than 10 cards off one shared deck — paste the deal order so the
            verifier maps each deck index to the exact card you received.
          </p>
        </div>
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
            <div className="text-2xl font-bold font-mono break-all whitespace-pre-line text-gradient">
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

/** Best blackjack total (Aces 11→1 as needed) — local so the verifier stays
 * WebCrypto-only and never imports the node-backed @scadium/fair. */
function handTotal(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      total += 11;
      aces++;
    } else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') {
      total += 10;
    } else {
      total += parseInt(c.rank, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

const fmtCard = (c: Card) => `${c.rank}${c.suit}`;

/**
 * Reproduce a blackjack round (or a single seat's hand) from the revealed seed
 * + the deal order. Accepts either the full deal-order log
 * (`[{deckIndex, dealtTo, handId}, …]`) → every seat/hand + dealer, or a flat
 * list of deck indices (`[0,3,6]`) → just that one hand. No hardcoded card count.
 */
async function verifyBlackjack(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  dealLogInput: string,
): Promise<string> {
  const trimmed = dealLogInput.trim();
  if (!trimmed) {
    throw new Error(
      'Paste the round deal log ([{deckIndex,dealtTo,handId}, …]) or your seat deck indices ([0,3,6]) — from the round’s fairness data',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Deal log must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Deal log must be a non-empty JSON array');
  }

  // Flat array of deck indices → reproduce a single hand.
  if (typeof parsed[0] === 'number') {
    const indices = parsed as number[];
    if (!indices.every((n) => Number.isInteger(n) && n >= 0)) {
      throw new Error('Deck indices must be non-negative integers');
    }
    const cards = await reproduceHand(serverSeed, clientSeed, nonce, indices);
    return `your hand: ${cards.map(fmtCard).join(' ')}  (${handTotal(cards)})`;
  }

  // Full deal-order log → reproduce every seat/hand + the dealer.
  const order = parsed as DealLogEntry[];
  if (!order.every((e) => e && typeof e.deckIndex === 'number' && e.handId !== undefined)) {
    throw new Error('Each deal-log entry needs a numeric deckIndex and a handId');
  }
  const hands = await reproduceRound(serverSeed, clientSeed, nonce, order);
  return hands
    .map((h) => {
      const who = h.dealtTo === 'dealer' ? 'dealer' : `seat ${h.dealtTo} (${h.handId})`;
      return `${who}: ${h.cards.map(fmtCard).join(' ')}  (${handTotal(h.cards)})`;
    })
    .join('\n');
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
