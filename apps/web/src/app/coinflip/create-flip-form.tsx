'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCreateCoinflip } from '@/hooks/use-coinflip';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';

const PRESETS = [
  { label: '0.1', lamports: '100000000' },
  { label: '0.5', lamports: '500000000' },
  { label: '1', lamports: '1000000000' },
  { label: '5', lamports: '5000000000' },
];

/**
 * Create-flip form: side picker (heads/tails), amount input with SOL→lamports
 * conversion, preset chips, and a big CTA. Optimistic — the new flip shows
 * in the lobby via socket event before the POST response returns.
 */
export function CreateFlipForm({ onCreated }: { onCreated?: () => void } = {}) {
  const [side, setSide] = useState<'heads' | 'tails'>('heads');
  const [sol, setSol] = useState('0.1');
  const mutation = useCreateCoinflip();

  function amountLamports(): string {
    const n = Number(sol);
    if (!Number.isFinite(n) || n <= 0) return '0';
    return Math.floor(n * 1_000_000_000).toString();
  }

  function submit() {
    const lamports = amountLamports();
    if (lamports === '0') return;
    mutation.mutate(
      { side, amountLamports: lamports },
      {
        onSuccess: () => {
          onCreated?.();
        },
      },
    );
  }

  const error =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'Failed to create flip'
        : null;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
          Your side
        </div>
        <div className="grid grid-cols-2 gap-2">
          <SideButton active={side === 'heads'} onClick={() => setSide('heads')} label="Heads" />
          <SideButton active={side === 'tails'} onClick={() => setSide('tails')} label="Tails" />
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
          Bet amount (SOL)
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0.001"
            value={sol}
            onChange={(e) => setSol(e.target.value)}
            className="flex-1 rounded-xl border border-border bg-surface-elevated px-4 h-11 text-sm font-mono focus:outline-none focus:border-primary-400"
          />
        </div>
        <div className="mt-2 flex gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setSol(p.label)}
              className={cn(
                'flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
                sol === p.label
                  ? 'border-primary-400/50 bg-primary-400/10 text-primary-400'
                  : 'border-border text-foreground-muted hover:border-primary-400/30',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <Button
        size="lg"
        className="w-full"
        onClick={submit}
        disabled={mutation.isPending || !sol || Number(sol) <= 0}
      >
        {mutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        Create flip
      </Button>

      {error && <p className="text-xs text-danger text-center">{error}</p>}

      <p className="text-[11px] text-foreground-muted text-center">
        Win pays 1.9× · House edge 5%
      </p>
    </div>
  );
}

function SideButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center justify-center py-4 rounded-xl border transition-all',
        active
          ? 'border-primary-400 bg-gradient-to-br from-primary-400/20 to-primary-700/20 shadow-glow-sm'
          : 'border-border bg-surface-elevated hover:border-primary-400/40',
      )}
    >
      <div
        className={cn(
          'h-10 w-10 rounded-full border-2 flex items-center justify-center font-bold',
          active ? 'border-primary-400 text-primary-400' : 'border-border text-foreground-muted',
        )}
      >
        {label === 'Heads' ? 'H' : 'T'}
      </div>
      <span className="mt-2 text-sm font-semibold">{label}</span>
    </button>
  );
}
