'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, DoorOpen, Loader2, User as UserIcon } from 'lucide-react';
import { Card as UICard } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import {
  useBlackjackTable,
  useBlackjackTables,
  useBlackjackActions,
  type BlackjackTableSnapshot,
  type TableSeat,
} from '@/hooks/use-blackjack';
import { useMe } from '@/hooks/use-me';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { ApiError } from '@/lib/api-client';
import { formatSol, shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';
import { CardFace } from './card-face';

const SEAT_POSITIONS: React.CSSProperties[] = [
  { left: '8%', bottom: '18%' },
  { left: '22%', bottom: '6%' },
  { left: '50%', bottom: '1%', transform: 'translateX(-50%)' },
  { right: '22%', bottom: '6%' },
  { right: '8%', bottom: '18%' },
];

/**
 * Multiplayer blackjack table (solpump structure): shared 5-seat felt,
 * PLACE YOUR BETS window with side bets, turn-based seat actions with a
 * visible clock, dealer reveal driven by staggered bj:card events, payout
 * rulebook modal, Find New Lobby / Play Alone.
 */
export function BlackjackTable() {
  const { isAuthenticated } = useWalletAuth();
  const { open: openWallet } = useWalletModal();
  const { data: me } = useMe();
  const tables = useBlackjackTables();
  const [tableId, setTableId] = useState<string | null>(null);
  const { snapshot: state, refetch } = useBlackjackTable(tableId);
  const actions = useBlackjackActions(tableId);
  const [error, setError] = useState<string | null>(null);
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Default to the first public table once the lobby list arrives.
  useEffect(() => {
    if (!tableId && tables.data && tables.data.length > 0) setTableId(tables.data[0]!.id);
  }, [tableId, tables.data]);

  // Phase countdowns (betting window / turn clock).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const mySeat = state?.seats.find((s) => s.userId === me?.id) ?? null;
  const myTurn =
    state?.phase === 'player_turns' && mySeat != null && state.activeSeat === mySeat.index;
  const secondsLeft = state?.closeAt ? Math.max(0, Math.ceil((state.closeAt - now) / 1000)) : null;

  async function run<T>(p: Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      const res = await p;
      refetch(); // don't rely on the socket having been connected in time
      return res;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Request failed');
      return undefined;
    }
  }

  function guard(): boolean {
    if (!isAuthenticated) {
      openWallet();
      return false;
    }
    return true;
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1 min-w-0 space-y-4">
        {/* Top bar: lobby controls + rulebook */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!guard()) return;
                const res = await run(actions.findLobby.mutateAsync());
                if (res) setTableId(res.tableId);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground-muted hover:text-foreground hover:border-primary-400/50 transition-colors"
            >
              <DoorOpen className="h-3.5 w-3.5 text-primary-400" />
              Find New Lobby
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!guard()) return;
                const res = await run(actions.solo.mutateAsync());
                if (res) setTableId(res.tableId);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground-muted hover:text-foreground hover:border-primary-400/50 transition-colors"
            >
              <UserIcon className="h-3.5 w-3.5 text-primary-400" />
              Play Alone
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground-muted">{state?.name ?? '…'}</span>
            <button
              type="button"
              onClick={() => setRulebookOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground-muted hover:text-foreground hover:border-primary-400/50 transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5 text-primary-400" />
              Payout Rulebook
            </button>
          </div>
        </div>

        {/* Table felt */}
        <div className="relative overflow-visible" style={{ minHeight: 520 }}>
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
                <stop offset="0%" stopColor="#3d3d5c" />
                <stop offset="100%" stopColor="#23233a" />
              </linearGradient>
            </defs>
            <path
              d="M 50,500 Q 50,60 500,40 Q 950,60 950,500 Z"
              fill="url(#rim)"
              stroke="#4a4a6a"
              strokeWidth="2"
            />
            <path
              d="M 70,490 Q 70,80 500,60 Q 930,80 930,490 Z"
              fill="url(#felt)"
              stroke="#3a3a55"
              strokeWidth="1"
            />
            <text x="500" y="280" textAnchor="middle" fill="rgba(255,255,255,0.04)" fontSize="24" fontWeight="bold" letterSpacing="8">
              BLACKJACK PAYS 3 TO 2
            </text>
            <text x="500" y="310" textAnchor="middle" fill="rgba(255,255,255,0.03)" fontSize="14" letterSpacing="4">
              DEALER HITS ON SOFT 17
            </text>
          </svg>

          {/* Dealer zone */}
          <div className="absolute top-[5%] left-1/2 -translate-x-1/2 flex flex-col items-center">
            <div className="flex items-end gap-3">
              <DealerAvatar dealing={state?.phase === 'dealing' || state?.phase === 'dealer_turn'} />
              <CardShoe />
            </div>
            <div className="mt-1.5 mb-2 flex items-center gap-2 rounded-full bg-black/40 px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted/70 backdrop-blur-sm">
              Dealer
              {state?.dealerTotal != null && (
                <span className="font-mono text-cyan-300">{state.dealerTotal}</span>
              )}
            </div>
            <div className="flex gap-1.5">
              {state?.dealerCards.length
                ? state.dealerCards.map((c, i) => (
                    <DealtCard key={i} index={i}>
                      <CardFace card={c} />
                    </DealtCard>
                  ))
                : [0, 1].map((i) => <CardFace key={i} card={null} placeholder />)}
            </div>
          </div>

          {/* PLACE YOUR BETS overlay */}
          {state && (state.phase === 'betting' || state.phase === 'idle') && (
            <div className="absolute top-[42%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              {state.phase === 'betting' && secondsLeft !== null && (
                <div
                  className="text-5xl font-black text-white/90 mb-1"
                  style={{ textShadow: '0 0 40px rgba(168,85,247,0.5)' }}
                >
                  {secondsLeft}
                </div>
              )}
              <div className="text-lg font-black uppercase tracking-[0.3em] text-foreground-muted">
                {state.phase === 'betting' ? 'Place Your Bets' : 'Waiting for players'}
              </div>
            </div>
          )}

          {/* Seats */}
          {SEAT_POSITIONS.map((pos, i) => {
            const seat = state?.seats.find((s) => s.index === i) ?? null;
            const isTurn = state?.phase === 'player_turns' && state.activeSeat === i;
            const hidden = (state?.maxSeats ?? 5) <= i;
            if (hidden) return null;
            return (
              <div key={i} className="absolute" style={pos}>
                <SeatSpot
                  seat={seat}
                  isMe={seat?.userId === me?.id}
                  isTurn={!!isTurn}
                  secondsLeft={isTurn ? secondsLeft : null}
                  onTake={async () => {
                    if (!guard()) return;
                    await run(actions.seat.mutateAsync(i));
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Controls under the felt */}
        <UICard className="p-5">
          {!state ? (
            <div className="py-6 text-center text-xs text-foreground-muted">Loading table…</div>
          ) : myTurn ? (
            <ActionBar
              seat={mySeat!}
              secondsLeft={secondsLeft}
              busy={actions.action.isPending}
              onAction={(a) => void run(actions.action.mutateAsync(a))}
            />
          ) : mySeat ? (
            <BetPanel
              state={state}
              mySeat={mySeat}
              busy={actions.bet.isPending || actions.clearBet.isPending || actions.leave.isPending}
              onBet={(p) => void run(actions.bet.mutateAsync(p))}
              onClear={() => void run(actions.clearBet.mutateAsync())}
              onLeave={() => void run(actions.leave.mutateAsync())}
            />
          ) : (
            <div className="py-4 text-center text-sm text-foreground-muted">
              Pick an <span className="text-primary-400 font-bold">Open Seat</span> on the table to
              join the next round.
            </div>
          )}
          {error && <p className="mt-3 text-xs text-danger text-center">{error}</p>}
        </UICard>
      </div>

      <RulebookModal
        open={rulebookOpen}
        onClose={() => setRulebookOpen(false)}
        sideBets={state?.config.sideBets ?? null}
      />
    </div>
  );
}

/** A card sliding in from the dealer's shoe as it's dealt. */
function DealtCard({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ x: 60, y: -28, opacity: 0, rotate: -10 }}
      animate={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26, delay: index * 0.08 }}
    >
      {children}
    </motion.div>
  );
}

/** A 2D neon-android croupier — idle float, blinking eyes, pulsing core. */
function DealerAvatar({ dealing = false }: { dealing?: boolean }) {
  return (
    <motion.div
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
      className="relative flex flex-col items-center"
    >
      {/* soft aura */}
      <div className="absolute -inset-5 -z-10 rounded-full bg-purple-500/20 blur-2xl" />
      {/* antenna */}
      <div className="h-3 w-px bg-purple-300/40" />
      <motion.div
        animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.25, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        className="-mb-0.5 h-1.5 w-1.5 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,0.9)]"
      />
      {/* head */}
      <div className="relative mt-1 h-14 w-16 rounded-2xl border border-purple-300/30 bg-gradient-to-b from-[#3b3660] to-[#241f3a] shadow-[0_6px_22px_rgba(124,92,255,0.4)]">
        {/* visor */}
        <div className="absolute left-1/2 top-1/2 flex h-5 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-2.5 rounded-md bg-[#07090d] shadow-inner">
          {[0, 1].map((i) => (
            <motion.span
              key={i}
              animate={{ scaleY: [1, 1, 0.1, 1], opacity: [1, 1, 0.4, 1] }}
              transition={{ duration: 4.2, repeat: Infinity, times: [0, 0.9, 0.95, 1], delay: i * 0.04 }}
              className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.95)]"
            />
          ))}
        </div>
      </div>
      {/* neck */}
      <div className="h-1.5 w-3 bg-[#15121f]" />
      {/* shoulders + bow tie + chest core */}
      <div className="relative h-7 w-24 rounded-t-[28px] border-t border-purple-300/20 bg-gradient-to-b from-[#2c2742] to-[#181527]">
        <div className="absolute left-1/2 top-1.5 flex -translate-x-1/2 items-center">
          <span className="h-0 w-0 border-y-[5px] border-r-[8px] border-y-transparent border-r-fuchsia-400/90" />
          <span className="h-2 w-2 rounded-[3px] bg-fuchsia-300" />
          <span className="h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-fuchsia-400/90" />
        </div>
        <motion.div
          animate={{ opacity: dealing ? [0.6, 1, 0.6] : [0.4, 0.8, 0.4] }}
          transition={{ duration: dealing ? 0.8 : 2.4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.85)]"
        />
      </div>
    </motion.div>
  );
}

/** The dealing shoe at the dealer's side — where the cards come from. */
function CardShoe() {
  return (
    <div className="relative mb-1 flex flex-col items-center" title="Card shoe">
      <div className="relative h-10 w-14 overflow-hidden rounded-md border border-purple-400/25 bg-gradient-to-br from-[#2a2540] to-[#15121f] shadow-[inset_0_2px_6px_rgba(0,0,0,0.5)]">
        {/* a couple of card edges peeking from the shoe */}
        <div className="absolute left-1.5 top-1 flex">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="-ml-3.5 h-7 w-5 rounded-[3px] border border-primary-400/30 bg-gradient-to-br from-primary-600 to-primary-800 first:ml-0"
              style={{ transform: `translateY(${-i}px)` }}
            />
          ))}
        </div>
        {/* lip of the shoe */}
        <div className="absolute inset-x-0 bottom-0 h-2 bg-gradient-to-t from-black/60 to-transparent" />
      </div>
      <span className="mt-0.5 text-[8px] uppercase tracking-widest text-foreground-muted/50">Shoe</span>
    </div>
  );
}

function SeatSpot({
  seat,
  isMe,
  isTurn,
  secondsLeft,
  onTake,
}: {
  seat: TableSeat | null;
  isMe: boolean;
  isTurn: boolean;
  secondsLeft: number | null;
  onTake: () => void;
}) {
  if (!seat) {
    return (
      <button
        type="button"
        onClick={onTake}
        className="flex h-16 w-20 flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-500/40 text-[9px] font-bold uppercase tracking-wider text-emerald-400/80 hover:bg-emerald-500/10 transition-colors"
      >
        Open Seat
      </button>
    );
  }
  const name = seat.username ?? shortAddress(seat.walletAddress);
  return (
    <div
      className={cn(
        'flex w-24 flex-col items-center rounded-xl border px-1.5 py-1.5 transition-all',
        isTurn
          ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.35)]'
          : seat.result === 'win' || seat.result === 'blackjack'
            ? 'border-success/50 bg-success/10'
            : seat.result === 'lose'
              ? 'border-danger/40 bg-danger/5'
              : 'border-border bg-surface/80',
      )}
    >
      {/* Cards above the chip row */}
      {seat.cards.length > 0 && (
        <div className="-mt-16 mb-1 flex">
          {seat.cards.map((c, i) => (
            <div key={i} className="origin-bottom scale-[0.55]" style={{ marginLeft: i > 0 ? -34 : 0 }}>
              <DealtCard index={i}>
                <CardFace card={c} />
              </DealtCard>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 w-full">
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white',
            isMe ? 'bg-gradient-primary' : 'bg-surface-elevated border border-border',
          )}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate text-[10px] font-bold">{isMe ? 'You' : name}</span>
        {isTurn && secondsLeft !== null && (
          <span className="ml-auto font-mono text-[10px] font-bold text-emerald-400">
            {secondsLeft}s
          </span>
        )}
      </div>
      <div className="mt-0.5 flex w-full items-center justify-between text-[9px] font-mono">
        <span className="text-foreground-muted">
          {seat.bet ? formatSol(seat.bet.mainLamports, 3) : '—'}
        </span>
        {seat.total !== null && (
          <span className={cn('font-bold', seat.status === 'busted' ? 'text-danger' : 'text-foreground')}>
            {seat.total}
          </span>
        )}
      </div>
      {seat.result && (
        <div
          className={cn(
            'mt-0.5 rounded px-1.5 py-px text-[8px] font-black uppercase',
            seat.result === 'lose' ? 'bg-danger/20 text-danger' : 'bg-success/20 text-success',
          )}
        >
          {seat.result === 'blackjack' ? 'BJ 3:2' : seat.result}
          {seat.payoutLamports !== '0' && ` +${formatSol(seat.payoutLamports, 3)}`}
        </div>
      )}
    </div>
  );
}

function ActionBar({
  seat,
  secondsLeft,
  busy,
  onAction,
}: {
  seat: TableSeat;
  secondsLeft: number | null;
  busy: boolean;
  onAction: (a: 'hit' | 'stand' | 'double') => void;
}) {
  const canDouble = seat.cards.length === 2;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-xs uppercase tracking-[0.3em] text-emerald-400 font-bold">
        Your turn{secondsLeft !== null ? ` · ${secondsLeft}s` : ''}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction('hit')}
          className="h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-8 text-sm font-black text-white transition-colors disabled:opacity-50"
        >
          HIT
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction('stand')}
          className="h-12 rounded-xl bg-surface-elevated border border-border hover:border-primary-400/50 px-8 text-sm font-black transition-colors disabled:opacity-50"
        >
          STAND
        </button>
        <button
          type="button"
          disabled={busy || !canDouble}
          onClick={() => onAction('double')}
          className="h-12 rounded-xl bg-primary-400/90 hover:bg-primary-400 px-8 text-sm font-black text-white transition-colors disabled:opacity-40"
        >
          DOUBLE
        </button>
      </div>
    </div>
  );
}

function BetPanel({
  state,
  mySeat,
  busy,
  onBet,
  onClear,
  onLeave,
}: {
  state: BlackjackTableSnapshot;
  mySeat: TableSeat;
  busy: boolean;
  onBet: (p: {
    mainLamports: string;
    side21p3Lamports?: string;
    sidePerfectPairsLamports?: string;
  }) => void;
  onClear: () => void;
  onLeave: () => void;
}) {
  const [main, setMain] = useState('0.1');
  const [side21, setSide21] = useState('');
  const [sidePP, setSidePP] = useState('');

  const canBet = state.phase === 'betting' || state.phase === 'idle';
  const lamports = (sol: string) =>
    sol && Number(sol) > 0 ? String(Math.floor(Number(sol) * 1e9)) : '0';

  const total = useMemo(
    () => (Number(main) || 0) + (Number(side21) || 0) + (Number(sidePP) || 0),
    [main, side21, sidePP],
  );

  if (!canBet) {
    return (
      <div className="py-3 text-center text-sm text-foreground-muted">
        {mySeat.bet ? (
          <>
            Round in progress — your bet{' '}
            <span className="font-mono font-bold text-foreground">
              {formatSol(mySeat.bet.mainLamports, 3)}
            </span>
          </>
        ) : (
          'Round in progress — you sit out until the next betting window.'
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end justify-center gap-3">
      <Field label="Main Bet (SOL)">
        <input
          type="number"
          step="0.001"
          min="0.001"
          value={main}
          onChange={(e) => setMain(e.target.value)}
          className="w-28 rounded-xl border border-border bg-surface-elevated px-3 h-10 text-sm font-mono focus:outline-none focus:border-primary-400"
        />
      </Field>
      <Field label="21+3">
        <input
          type="number"
          step="0.001"
          min="0"
          placeholder="0"
          value={side21}
          onChange={(e) => setSide21(e.target.value)}
          className="w-24 rounded-xl border border-border bg-surface-elevated px-3 h-10 text-sm font-mono focus:outline-none focus:border-primary-400"
        />
      </Field>
      <Field label="Perfect Pair">
        <input
          type="number"
          step="0.001"
          min="0"
          placeholder="0"
          value={sidePP}
          onChange={(e) => setSidePP(e.target.value)}
          className="w-24 rounded-xl border border-border bg-surface-elevated px-3 h-10 text-sm font-mono focus:outline-none focus:border-primary-400"
        />
      </Field>
      <button
        type="button"
        disabled={busy || !main || Number(main) <= 0}
        onClick={() =>
          onBet({
            mainLamports: lamports(main),
            side21p3Lamports: lamports(side21),
            sidePerfectPairsLamports: lamports(sidePP),
          })
        }
        className="h-10 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-5 text-sm font-bold text-white transition-colors disabled:opacity-50"
      >
        {busy ? <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> : null}
        {mySeat.bet ? 'Update Bet' : 'Place Bet'} · {total.toFixed(3)}
      </button>
      {mySeat.bet && (
        <button
          type="button"
          disabled={busy || state.phase !== 'betting'}
          onClick={onClear}
          className="h-10 rounded-xl border border-border px-4 text-xs font-bold text-foreground-muted hover:text-foreground transition-colors disabled:opacity-40"
        >
          Clear Bets
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onLeave}
        className="h-10 rounded-xl border border-danger/40 px-4 text-xs font-bold text-danger hover:bg-danger/10 transition-colors disabled:opacity-40"
      >
        Leave Seat
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-foreground-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function RulebookModal({
  open,
  onClose,
  sideBets,
}: {
  open: boolean;
  onClose: () => void;
  sideBets: {
    twentyOnePlusThree: Record<string, number>;
    perfectPairs: Record<string, number>;
  } | null;
}) {
  const tp = sideBets?.twentyOnePlusThree;
  const pp = sideBets?.perfectPairs;
  return (
    <Dialog open={open} onClose={onClose} title="Payout Rulebook" className="max-w-lg">
      <div className="space-y-5 text-sm">
        <section>
          <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-foreground-muted">
            Main hand
          </h3>
          <Rule mult="3:2" name="Blackjack" desc="A natural 21 on your first two cards" />
          <Rule mult="1:1" name="Win" desc="Beat the dealer without busting" />
          <Rule mult="Push" name="Tie" desc="Stake returned" />
        </section>
        <section>
          <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-foreground-muted">
            21+3 — your two cards + dealer&apos;s upcard
          </h3>
          <Rule mult={`×${tp?.flush ?? 5}`} name="Flush" desc="Three cards in the same suit" />
          <Rule mult={`×${tp?.straight ?? 10}`} name="Straight" desc="Three consecutive values" />
          <Rule
            mult={`×${tp?.three_of_a_kind ?? 30}`}
            name="Three of a Kind"
            desc="Three cards of the same value"
          />
          <Rule
            mult={`×${tp?.straight_flush ?? 40}`}
            name="Straight Flush"
            desc="Three consecutive cards in the same suit"
          />
          <Rule
            mult={`×${tp?.suited_trips ?? 100}`}
            name="Suited Three of a Kind"
            desc="Identical cards — same value and suit"
            gold
          />
        </section>
        <section>
          <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-foreground-muted">
            Perfect Pairs — your two cards
          </h3>
          <Rule mult={`×${pp?.mixed ?? 5}`} name="Mixed Pair" desc="Same value, different colors" />
          <Rule mult={`×${pp?.colored ?? 10}`} name="Colored Pair" desc="Same value and color" />
          <Rule
            mult={`×${pp?.perfect ?? 25}`}
            name="Perfect Pair"
            desc="Same value and suit"
            gold
          />
        </section>
      </div>
    </Dialog>
  );
}

function Rule({
  mult,
  name,
  desc,
  gold,
}: {
  mult: string;
  name: string;
  desc: string;
  gold?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span
        className={cn(
          'w-14 shrink-0 rounded-lg px-2 py-1 text-center font-mono text-xs font-black',
          gold
            ? 'bg-amber-400/15 text-amber-400 border border-amber-400/40'
            : 'bg-primary-400/10 text-primary-300 border border-primary-400/30',
        )}
      >
        {mult}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-bold">{name}</div>
        <div className="text-[11px] text-foreground-muted">{desc}</div>
      </div>
    </div>
  );
}
