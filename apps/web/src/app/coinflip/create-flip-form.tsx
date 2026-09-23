'use client';

import { useState } from 'react';
import { Landmark, Loader2, Plus } from 'lucide-react';
import { COINFLIP } from '@scadium/shared';
import { useCreateCoinflip, type CoinflipGame } from '@/hooks/use-coinflip';
import { useGameSound } from '@/components/instant/use-game-sound';
import { isValidBetSol, solToLamportsClamped } from '@/components/instant/bet-amount-input';
import { ApiError } from '@/lib/api-client';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';

const PRESETS = ['0.1', '0.5', '1', '5'];

/**
 * Horizontal create bar (solpump header style): bet amount + preset chips,
 * Choose Side coin buttons (H purple / T cyan) and two CTAs — "+ Create Flip"
 * waits for another player, "Flip vs House" resolves at once (on a quiet site
 * nobody may come). Wraps on mobile. The new flip lands in the lobby via socket.
 */
export function CreateFlipBar({
  onCreated,
}: {
  /** Called with the created flip — a house flip arrives already resolved. */
  onCreated?: (game: CoinflipGame) => void;
} = {}) {
  const [side, setSide] = useState<'heads' | 'tails'>('heads');
  const [sol, setSol] = useState('0.1');
  const mutation = useCreateCoinflip();
  const sound = useGameSound();
  const valid = isValidBetSol(sol, COINFLIP.MIN_BET_LAMPORTS);
  const lamports = solToLamportsClamped(sol, COINFLIP.MIN_BET_LAMPORTS, COINFLIP.MAX_BET_LAMPORTS);
  // What a win pays back, from the same constant the server pays with.
  const winLamports =
    (BigInt(lamports) * BigInt(Math.round(COINFLIP.PAYOUT_MULTIPLIER * 100))) / BigInt(100);

  function submit(vsHouse: boolean) {
    if (!valid) return;
    sound.bet();
    mutation.mutate(
      { side, amountLamports: lamports, vsHouse },
      { onSuccess: (g) => onCreated?.(g) },
    );
  }

  const error =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'Failed to create flip'
        : null;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        {/* Bet amount */}
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-foreground-muted">
            Bet Amount (SOL)
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0.001"
              value={sol}
              onChange={(e) => setSol(e.target.value)}
              className="w-28 rounded-xl border border-border bg-surface-elevated px-3 h-10 text-sm font-mono focus:outline-none focus:border-primary-400"
            />
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSol(p)}
                className={cn(
                  'px-2.5 h-10 text-xs font-semibold rounded-lg border transition-colors',
                  sol === p
                    ? 'border-primary-400/50 bg-primary-400/10 text-primary-400'
                    : 'border-border text-foreground-muted hover:border-primary-400/30',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Choose side — two mini coins */}
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-foreground-muted">
            Choose Side
          </div>
          <div className="flex gap-1.5">
            <SideCoin side="heads" active={side === 'heads'} onClick={() => setSide('heads')} />
            <SideCoin side="tails" active={side === 'tails'} onClick={() => setSide('tails')} />
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={mutation.isPending || !valid}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 text-sm font-bold text-white transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] disabled:opacity-50"
          >
            {mutation.isPending && !mutation.variables?.vsHouse ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create Flip
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={mutation.isPending || !valid}
            title="Resolve now against the house, at the same payout"
            className="flex h-10 items-center gap-1.5 rounded-xl border border-primary-400/50 bg-primary-400/10 hover:bg-primary-400/20 px-4 text-sm font-bold text-primary-300 transition-colors disabled:opacity-50"
          >
            {mutation.isPending && mutation.variables?.vsHouse ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Landmark className="h-4 w-4" />
            )}
            Flip vs House
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-foreground-muted">
        {valid ? (
          <>
            Win{' '}
            <span className="font-mono text-foreground">
              {formatSol(winLamports.toString(), 4)} SOL
            </span>{' '}
            ({COINFLIP.PAYOUT_MULTIPLIER}×) · an unjoined flip is refunded after{' '}
            {Math.round(COINFLIP.OPEN_TTL_MS / 60_000)} min
          </>
        ) : (
          'Enter a valid amount'
        )}
      </p>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

function SideCoin({
  side,
  active,
  onClick,
}: {
  side: 'heads' | 'tails';
  active: boolean;
  onClick: () => void;
}) {
  const heads = side === 'heads';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Pick ${side}`}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full text-sm font-black text-white transition-all',
        heads
          ? 'bg-gradient-to-br from-primary-400 to-primary-700'
          : 'bg-gradient-to-br from-cyan-400 to-cyan-700',
        active
          ? heads
            ? 'ring-2 ring-primary-400 scale-105 shadow-glow-sm'
            : 'ring-2 ring-cyan-400 scale-105 shadow-[0_0_20px_rgba(34,211,238,0.4)]'
          : 'opacity-50 hover:opacity-80',
      )}
    >
      {heads ? 'H' : 'T'}
    </button>
  );
}
