'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, HandCoins } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useAirdropPool } from '@/hooks/use-platform';
import { cn } from '@/lib/cn';

function lamportsToSolStr(lamports: string): string {
  return (Number(BigInt(lamports)) / 1e9).toFixed(2);
}

/**
 * Left-rail hourly airdrop pool widget (solpump shell): pool amount + mm:ss
 * countdown; clicking opens the tip dialog ("your tip will be added to the
 * airdrop — this action is not refundable").
 */
export function AirdropWidget() {
  const token = useAuthStore((s) => s.accessToken);
  const { pool, lastDrop } = useAirdropPool();
  const [now, setNow] = useState(() => Date.now());
  const [tipOpen, setTipOpen] = useState(false);
  const [amount, setAmount] = useState('0.01');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const countdown = useMemo(() => {
    if (!pool) return '--:--';
    const s = Math.max(0, Math.ceil((pool.endsAt - now) / 1000));
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, [pool, now]);

  const tip = useMutation({
    mutationFn: (lamports: bigint) =>
      api('/airdrop/tip', { method: 'POST', body: { amountLamports: lamports.toString() }, token }),
    onSuccess: () => {
      setTipOpen(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Tip failed'),
  });

  function submitTip() {
    setError(null);
    const sol = Number(amount);
    if (!Number.isFinite(sol) || sol <= 0) {
      setError('Enter a positive amount');
      return;
    }
    tip.mutate(BigInt(Math.round(sol * 1e9)));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setTipOpen(true)}
        className="w-full rounded-xl border border-primary-400/30 bg-gradient-to-r from-primary-400/15 to-surface p-3 text-left transition-colors hover:border-primary-400/60"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-primary-300">
            <Gift className="h-3.5 w-3.5" />
            Airdrop
          </span>
          <span className="text-[10px] font-mono font-bold text-foreground-muted">{countdown}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-lg font-black font-mono">
            {pool ? lamportsToSolStr(pool.poolLamports) : '—'}{' '}
            <span className="text-[10px] font-bold text-foreground-muted">SOL</span>
          </span>
          {(pool?.tipsCount ?? 0) > 0 && (
            <span className="text-[9px] text-foreground-muted">{pool!.tipsCount} tips</span>
          )}
        </div>
        {lastDrop && (
          <div className="mt-1 text-[9px] text-success">
            Last drop: {lamportsToSolStr(lastDrop.totalLamports)} SOL →{' '}
            {lastDrop.participantCount} player{lastDrop.participantCount === 1 ? '' : 's'}
          </div>
        )}
      </button>

      <Dialog
        open={tipOpen}
        onClose={() => setTipOpen(false)}
        title="Tipping — Airdrop"
        description="Wager and chat this hour to qualify for the drop."
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface-elevated px-3 py-2">
            <span className="text-xs text-foreground-muted">Current pool</span>
            <span className="font-mono text-sm font-bold">
              {pool ? lamportsToSolStr(pool.poolLamports) : '—'} SOL ·{' '}
              <span className="text-foreground-muted">{countdown}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary-400"
              aria-label="Tip amount in SOL"
            />
            <button
              type="button"
              disabled={tip.isPending || !token}
              onClick={submitTip}
              className={cn(
                'flex items-center gap-1.5 rounded-xl bg-gradient-primary px-4 py-2 text-sm font-bold text-white transition-opacity',
                (tip.isPending || !token) && 'opacity-50',
              )}
            >
              <HandCoins className="h-4 w-4" />
              Tip
            </button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <p className="text-center text-[10px] text-foreground-muted">
            Your tip will be added to the Airdrop.{' '}
            <span className="font-semibold">This action is not refundable.</span>
          </p>
        </div>
      </Dialog>
    </>
  );
}
