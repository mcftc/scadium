'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, Loader2, Repeat } from 'lucide-react';
import { useCrashActions, type CrashSnapshot } from '@/hooks/use-crash';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { useLocalStorageValue, writeLocalStorageValue } from '@/hooks/use-local-storage-value';
import { useMe } from '@/hooks/use-me';
import { ApiError } from '@/lib/api-client';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';

const PRESETS = ['0.1', '0.5', '1', '5'];
const CASHOUT_PCT_KEY = 'scadium-crash-cashout-pct';

export function CrashBetPanel({ state }: { state: CrashSnapshot | null }) {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const { data: me } = useMe();
  const { placeBet, cashOut, scheduleBet, cancelSchedule } = useCrashActions();
  const [sol, setSol] = useState('0.1');
  const [autoCashout, setAutoCashout] = useState('2.0');
  const [cashoutPct, setCashoutPct] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState(false);
  // Advanced Betting
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [autoBet, setAutoBet] = useState(false);
  const autoBetRef = useRef(autoBet);
  autoBetRef.current = autoBet;

  // Default progressive-cashout % persists across sessions. Read reactively
  // (null on SSR → no hydration mismatch) and apply during render on its edge
  // rather than via a setState-in-effect; a user pick overrides afterwards.
  const savedPct = Number(useLocalStorageValue(CASHOUT_PCT_KEY));
  const [syncedPct, setSyncedPct] = useState<number | null>(null);
  if (savedPct >= 10 && savedPct <= 100 && savedPct !== syncedPct) {
    setSyncedPct(savedPct);
    setCashoutPct(savedPct);
  }
  function pickCashoutPct(p: number) {
    setCashoutPct(p);
    writeLocalStorageValue(CASHOUT_PCT_KEY, String(p));
  }

  const myBet = state?.bets.find((b) => b.userId === me?.id) ?? null;
  const phase = state?.phase ?? 'waiting';
  const canBet = phase === 'waiting' && !myBet;
  const canCashout = phase === 'running' && myBet && myBet.cashedOutAt === null;

  // My scheduled bet auto-places at round start → the bet-placed upsert makes
  // it MY bet in the fresh round; drop the local "scheduled" flag then. Done
  // during render on the edge where the server-pushed `myBet` appears, rather
  // than via a setState-in-effect.
  if (scheduled && phase === 'waiting' && myBet) setScheduled(false);

  // Auto Bet (Advanced): re-place the same bet whenever a fresh betting
  // window opens and we don't already have a bet riding or queued.
  useEffect(() => {
    if (!autoBet || phase !== 'waiting' || myBet || scheduled || busy) return;
    const t = setTimeout(() => {
      if (!autoBetRef.current) return;
      void onPlace().catch(() => setAutoBet(false));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBet, phase, state?.roundId, myBet, scheduled]);

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
      if (autoBet) setAutoBet(false); // stop the loop on failure (e.g. balance)
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function onSchedule() {
    if (!isAuthenticated) {
      openWallet();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const lamports = String(Math.floor(Number(sol) * 1e9));
      const target = autoCashout ? Number(autoCashout) : null;
      await scheduleBet({ amountLamports: lamports, autoCashout: target });
      setScheduled(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Schedule failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCancelSchedule() {
    setError(null);
    setBusy(true);
    try {
      await cancelSchedule();
      setScheduled(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCashout() {
    setError(null);
    setBusy(true);
    try {
      await cashOut(cashoutPct);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Cashout failed');
    } finally {
      setBusy(false);
    }
  }

  const inputsLocked = !canBet && !scheduled ? phase !== 'running' && phase !== 'busted' : false;
  // Inputs stay editable whenever the next action is a schedule (mid-round)
  // or a fresh bet; they lock only while OUR bet is waiting to fly.
  const editable = (canBet || phase === 'running' || phase === 'busted') && !scheduled;

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
            disabled={!editable}
            className="w-full rounded-xl border border-border bg-surface-elevated pl-4 pr-28 h-11 text-sm font-mono focus:outline-none focus:border-primary-400 disabled:opacity-50"
          />
          <div className="absolute right-1 top-1 bottom-1 flex gap-0.5">
            <button
              type="button"
              onClick={() => setSol((v) => String(Math.max(0.001, Number(v) / 2)))}
              disabled={!editable}
              className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              ½
            </button>
            <button
              type="button"
              onClick={() => setSol((v) => String(Number(v) * 2))}
              disabled={!editable}
              className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              ×2
            </button>
            <button
              type="button"
              onClick={() => setSol('10')}
              disabled={!editable}
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
              disabled={!editable}
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
          disabled={!editable}
          placeholder="2.00"
          className="w-full rounded-xl border border-border bg-surface-elevated px-4 h-11 text-sm font-mono focus:outline-none focus:border-primary-400 disabled:opacity-50"
        />
      </div>

      {canCashout ? (
        <div className="space-y-3">
          {/* Progressive cashout — take part of the position, let the rest ride */}
          <div>
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-foreground-muted mb-2">
              <span>Progressive cashout</span>
              <span className="font-mono text-foreground">{cashoutPct}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={cashoutPct}
              onChange={(e) => pickCashoutPct(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
            <div className="mt-1.5 flex gap-1">
              {[10, 25, 50, 100].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => pickCashoutPct(p)}
                  className={cn(
                    'flex-1 py-1 text-[10px] font-bold rounded-lg border transition-colors',
                    cashoutPct === p
                      ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-300'
                      : 'border-border text-foreground-muted hover:border-emerald-400/30',
                  )}
                >
                  {p === 100 ? 'MAX' : `${p}%`}
                </button>
              ))}
            </div>
          </div>
          {/* Green cashout button */}
          <button
            type="button"
            onClick={onCashout}
            disabled={busy}
            className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> : null}
            Cash out {cashoutPct < 100 ? `${cashoutPct}% ` : ''}at {state?.multiplier.toFixed(2)}× ·{' '}
            {formatSol(
              (
                (((BigInt(myBet!.amountLamports) * BigInt(cashoutPct)) / BigInt(100)) *
                  BigInt(Math.floor((state?.multiplier ?? 1) * 100))) /
                BigInt(100)
              ).toString(),
              3,
            )}
          </button>
        </div>
      ) : scheduled ? (
        /* Queued for next round — click cancels and refunds. */
        <button
          type="button"
          onClick={onCancelSchedule}
          disabled={busy}
          className="w-full h-12 rounded-xl border border-primary-400/60 bg-primary-400/10 text-primary-300 font-bold text-sm transition-colors hover:bg-primary-400/20 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> : null}
          Scheduled for next round — tap to cancel
        </button>
      ) : canBet ? (
        <button
          type="button"
          onClick={() => void onPlace().catch(() => {})}
          disabled={busy}
          className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> : null}
          Place Bet
        </button>
      ) : (
        /* Mid-round (or my bet already riding/waiting) → queue for the next one. */
        <button
          type="button"
          onClick={onSchedule}
          disabled={busy || inputsLocked}
          className="w-full h-12 rounded-xl bg-primary-400/90 hover:bg-primary-400 text-white font-bold text-sm transition-all shadow-glow-sm disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
          ) : (
            <CalendarClock className="h-4 w-4 inline mr-2 -mt-0.5" />
          )}
          Schedule Bet For Next Round
        </button>
      )}

      {/* Advanced Betting (solpump-style collapsible) */}
      <div className="rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground-muted hover:text-foreground transition-colors"
        >
          Advanced Betting
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')}
          />
        </button>
        {advancedOpen && (
          <div className="space-y-3 border-t border-border px-3 py-3">
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Repeat className="h-3.5 w-3.5 text-primary-400" />
                Auto Bet
                <span className="text-[10px] text-foreground-muted font-normal">
                  re-places this bet every round
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={autoBet}
                onClick={() => setAutoBet((v) => !v)}
                className={cn(
                  'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                  autoBet ? 'bg-emerald-500' : 'bg-surface-elevated border border-border',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
                    autoBet ? 'left-[18px]' : 'left-0.5',
                  )}
                />
              </button>
            </label>
            <p className="text-[10px] text-foreground-muted">
              Default progressive cashout: <span className="font-mono">{cashoutPct}%</span> — adjust
              the slider during a round to change it. Auto Bet stops automatically if a bet fails
              (e.g. insufficient balance).
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <p className="text-[11px] text-foreground-muted text-center">
        Server-authoritative · RTP 95% · Provably fair
      </p>
    </div>
  );
}
