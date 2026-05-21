'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCrashActions, type CrashSnapshot } from '@/hooks/use-crash';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { useMe } from '@/hooks/use-me';
import { ApiError } from '@/lib/api-client';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';

const PRESETS = ['0.1', '0.5', '1', '5'];

export function CrashBetPanel({ state }: { state: CrashSnapshot | null }) {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const { data: me } = useMe();
  const { placeBet, cashOut } = useCrashActions();
  const [sol, setSol] = useState('0.1');
  const [autoCashout, setAutoCashout] = useState('2.0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myBet = state?.bets.find((b) => b.userId === me?.id) ?? null;
  const phase = state?.phase ?? 'waiting';
  const canBet = phase === 'waiting' && !myBet;
  const canCashout = phase === 'running' && myBet && myBet.cashedOutAt === null;

  async function onPlace() {
    if (!isAuthenticated) {
      openWallet();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const lamports = String(Math.floor(Number(sol) * 1e9));
      const target = autoCashout ? Number(autoCashout) : null;
      await placeBet({ amountLamports: lamports, autoCashout: target });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bet failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCashout() {
    setError(null);
    setBusy(true);
    try {
      await cashOut();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Cashout failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
          Bet amount (SOL)
        </div>
        {/* Input with ½/×2/MAX integrated inside */}
        <div className="relative">
          <input
            type="number"
            step="0.001"
            min="0.001"
            value={sol}
            onChange={(e) => setSol(e.target.value)}
            disabled={!canBet}
            className="w-full rounded-xl border border-border bg-surface-elevated pl-4 pr-28 h-11 text-sm font-mono focus:outline-none focus:border-primary-400 disabled:opacity-50"
          />
          <div className="absolute right-1 top-1 bottom-1 flex gap-0.5">
            <button
              type="button"
              onClick={() => setSol((v) => String(Math.max(0.001, Number(v) / 2)))}
              disabled={!canBet}
              className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              ½
            </button>
            <button
              type="button"
              onClick={() => setSol((v) => String(Number(v) * 2))}
              disabled={!canBet}
              className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              ×2
            </button>
            <button
              type="button"
              onClick={() => setSol('10')}
              disabled={!canBet}
              className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              MAX
            </button>
          </div>
        </div>
        <div className="mt-2 flex gap-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSol(p)}
              disabled={!canBet}
              className={cn(
                'flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50',
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

      <div>
        <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
          Auto cash-out (×)
        </div>
        <input
          type="number"
          step="0.01"
          min="1.01"
          value={autoCashout}
          onChange={(e) => setAutoCashout(e.target.value)}
          disabled={!canBet}
          placeholder="2.00"
          className="w-full rounded-xl border border-border bg-surface-elevated px-4 h-11 text-sm font-mono focus:outline-none focus:border-primary-400 disabled:opacity-50"
        />
      </div>

      {canCashout ? (
        /* Green cashout button like solpump */
        <button
          type="button"
          onClick={onCashout}
          disabled={busy}
          className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> : null}
          Cash out at {state?.multiplier.toFixed(2)}× ·{' '}
          {formatSol(
            (
              (BigInt(myBet!.amountLamports) * BigInt(Math.floor((state?.multiplier ?? 1) * 100))) /
              BigInt(100)
            ).toString(),
            3,
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={onPlace}
          disabled={busy || !canBet}
          className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50 disabled:bg-surface-elevated disabled:text-foreground-muted disabled:shadow-none"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> : null}
          {phase === 'waiting'
            ? myBet
              ? 'Bet placed — waiting'
              : 'Place Bet'
            : phase === 'running'
              ? 'Round in progress'
              : 'Round busted'}
        </button>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      <p className="text-[11px] text-foreground-muted text-center">
        Server-authoritative · RTP 95% · Provably fair
      </p>
    </div>
  );
}
