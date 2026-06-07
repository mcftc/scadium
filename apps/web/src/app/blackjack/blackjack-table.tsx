'use client';

import { useState } from 'react';
import { Loader2, User } from 'lucide-react';
import { Card as UICard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CardFace } from './card-face';
import {
  useBlackjackActive,
  useStartBlackjack,
  useBlackjackAction,
  type BlackjackState,
} from '@/hooks/use-blackjack';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { formatSol } from '@/lib/format';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';

const PRESETS = ['0.1', '0.5', '1', '2'];

export function BlackjackTable() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const { data: state, isLoading } = useBlackjackActive();
  const startMut = useStartBlackjack();
  const actionMut = useBlackjackAction();
  const [sol, setSol] = useState('0.1');
  const [error, setError] = useState<string | null>(null);

  function onStart() {
    if (!isAuthenticated) return openWallet();
    setError(null);
    startMut.mutate(String(Math.floor(Number(sol) * 1e9)), {
      onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
    });
  }
  function onAction(action: 'hit' | 'stand' | 'double') {
    setError(null);
    actionMut.mutate(action, {
      onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
    });
  }

  const hasHand = !!state && state.phase !== 'settled';

  return (
    <div className="flex gap-4">
      {/* CENTER: Table — chat lives in the global left rail (AppShell). */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-black tracking-tight">SOLANA BLACKJACK</h1>
        </div>

        {/* D-shaped felt table matching solpump's charcoal semicircle */}
        <div className="relative overflow-visible" style={{ minHeight: 500 }}>
          {/* Table shape: SVG semicircle/D-shape */}
          <svg
            viewBox="0 0 1000 550"
            className="w-full h-auto"
            style={{ filter: 'drop-shadow(0 10px 40px rgba(0,0,0,0.5))' }}
          >
            <defs>
              <radialGradient id="felt" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#2a2a3a" />
                <stop offset="60%" stopColor="#1a1a28" />
                <stop offset="100%" stopColor="#111118" />
              </radialGradient>
              <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3a3a50" />
                <stop offset="100%" stopColor="#1e1e2e" />
              </linearGradient>
            </defs>
            {/* Outer rim */}
            <path
              d="M 50,500 Q 50,60 500,40 Q 950,60 950,500 Z"
              fill="url(#rim)"
              stroke="#4a4a6a"
              strokeWidth="2"
            />
            {/* Inner felt */}
            <path
              d="M 70,490 Q 70,80 500,60 Q 930,80 930,490 Z"
              fill="url(#felt)"
              stroke="#3a3a55"
              strokeWidth="1"
            />
            {/* Felt text watermark */}
            <text x="500" y="280" textAnchor="middle" fill="rgba(255,255,255,0.04)" fontSize="24" fontWeight="bold" letterSpacing="8">
              BLACKJACK PAYS 3 TO 2
            </text>
            <text x="500" y="310" textAnchor="middle" fill="rgba(255,255,255,0.03)" fontSize="14" letterSpacing="4">
              DEALER HITS ON SOFT 17
            </text>
          </svg>

          {/* Dealer: card shoe + cards — positioned absolutely over SVG */}
          <div className="absolute top-[8%] left-1/2 -translate-x-1/2 flex flex-col items-center">
            {/* Card shoe visual */}
            <div className="flex items-end gap-[-2px] mb-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="w-8 h-11 rounded-sm bg-gradient-to-br from-indigo-900 to-indigo-950 border border-indigo-700/30"
                  style={{ marginLeft: i > 0 ? -6 : 0, transform: `translateY(${i * -1}px)` }}
                />
              ))}
            </div>
            {/* Dealer avatar */}
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500/30 to-indigo-500/30 border-2 border-purple-400/30 flex items-center justify-center mb-2">
              <span className="text-lg">🤖</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-muted/50 mb-2">
              Dealer {state?.dealerTotal ? `· ${state.dealerTotal}` : ''}
            </div>
            <div className="flex gap-1.5">
              {state?.dealerCards?.length
                ? state.dealerCards.map((c, i) => <CardFace key={i} card={c} />)
                : [0, 1].map((i) => <CardFace key={i} card={null} placeholder />)}
            </div>
          </div>

          {/* Center result */}
          {state?.phase === 'settled' && state.result && (
            <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2">
              <ResultBanner state={state} />
            </div>
          )}

          {/* Player cards (center-bottom of table arc) */}
          <div className="absolute bottom-[25%] left-1/2 -translate-x-1/2 flex flex-col items-center">
            <div className="flex gap-1.5 mb-2">
              {state?.playerCards?.length
                ? state.playerCards.map((c, i) => <CardFace key={i} card={c} />)
                : null}
            </div>
            {state?.playerTotal && (
              <div className="text-[10px] uppercase tracking-wider text-foreground-muted/50">
                You · {state.playerTotal}
              </div>
            )}
          </div>

          {/* 5 Seat positions around the D-shape curve */}
          {[
            { left: '8%', bottom: '18%' },
            { left: '22%', bottom: '6%' },
            { left: '50%', bottom: '1%', transform: 'translateX(-50%)' },
            { right: '22%', bottom: '6%' },
            { right: '8%', bottom: '18%' },
          ].map((pos, i) => (
            <div
              key={i}
              className="absolute"
              style={pos as React.CSSProperties}
            >
              <SeatPosition index={i} active={i === 2 && hasHand} />
            </div>
          ))}
        </div>

        {/* Controls */}
        <UICard className="p-5">
          {isLoading ? (
            <div className="py-6 text-center text-foreground-muted text-sm">Loading...</div>
          ) : state && state.phase !== 'settled' ? (
            <div className="space-y-4">
              <div className="text-center text-sm text-foreground-muted">
                Bet: {formatSol(state.playerBet, 3)}
                {state.doubled && ' (doubled)'}
              </div>
              <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
                <Button size="lg" onClick={() => onAction('hit')} disabled={!state.canHit || actionMut.isPending}>
                  Hit
                </Button>
                <Button size="lg" variant="secondary" onClick={() => onAction('stand')} disabled={!state.canStand || actionMut.isPending}>
                  Stand
                </Button>
                <Button size="lg" variant="outline" onClick={() => onAction('double')} disabled={!state.canDouble || actionMut.isPending}>
                  Double
                </Button>
              </div>
            </div>
          ) : (
            <div className="max-w-md mx-auto space-y-4">
              <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2 text-center">
                Bet amount (SOL)
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={sol}
                  onChange={(e) => setSol(e.target.value)}
                  className="flex-1 rounded-xl border border-border bg-surface-elevated px-4 h-11 text-sm font-mono focus:outline-none focus:border-primary-400"
                />
              </div>
              <div className="flex gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSol(p)}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
                      sol === p
                        ? 'border-primary-400/50 bg-primary-400/10 text-primary-400'
                        : 'border-border text-foreground-muted hover:border-primary-400/30',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <Button size="lg" className="w-full" onClick={onStart} disabled={startMut.isPending}>
                {startMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {state?.phase === 'settled' ? 'Deal Again' : 'Deal'}
              </Button>
            </div>
          )}
          {error && <p className="text-xs text-danger text-center mt-3">{error}</p>}
        </UICard>
      </div>
    </div>
  );
}

function SeatPosition({ index, active }: { index: number; active: boolean }) {
  return (
    <div
      className={cn(
        'h-14 w-14 rounded-xl border-2 flex flex-col items-center justify-center transition-all cursor-pointer',
        active
          ? 'border-emerald-400 bg-emerald-400/10 shadow-[0_0_15px_rgba(52,211,153,0.3)]'
          : 'border-emerald-500/20 bg-emerald-900/20 hover:border-emerald-500/40',
      )}
    >
      {active ? (
        <User className="h-5 w-5 text-emerald-400" />
      ) : (
        <>
          <div className="text-[8px] uppercase tracking-wider text-emerald-400/40 font-semibold">
            Open
          </div>
          <div className="text-[7px] uppercase tracking-wider text-emerald-400/30">
            Seat
          </div>
        </>
      )}
    </div>
  );
}

function ResultBanner({ state }: { state: BlackjackState }) {
  const { result, payoutLamports } = state;
  const colors: Record<string, string> = {
    win: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
    blackjack: 'text-yellow-300 border-yellow-400/30 bg-yellow-400/10',
    push: 'text-foreground-muted border-border bg-surface-elevated',
    lose: 'text-red-400 border-red-400/30 bg-red-400/10',
  };
  const labels: Record<string, string> = {
    win: 'You Win!',
    blackjack: 'Blackjack! 3:2',
    push: 'Push',
    lose: 'Dealer Wins',
  };
  return (
    <div className={cn('my-6 rounded-2xl border px-8 py-4 text-center font-bold', colors[result!])}>
      <div className="text-lg uppercase tracking-wider">{labels[result!]}</div>
      {payoutLamports && BigInt(payoutLamports) > BigInt(0) && (
        <div className="text-3xl font-mono mt-1">{formatSol(payoutLamports, 3)}</div>
      )}
    </div>
  );
}
