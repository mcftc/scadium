'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Trophy, Users, Coins, ShieldCheck, ExternalLink, Crown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConnectButton } from '@/components/wallet/connect-button';
import { useMe } from '@/hooks/use-me';
import { useAuthStore } from '@/store/auth-store';
import { useSocket } from '@/providers/socket-provider';
import { formatSol, lamportsToSol, shortAddress } from '@/lib/format';
import {
  useJackpot,
  useEnterJackpot,
  useMyJackpot,
  useJackpotRecent,
  type JackpotSnapshot,
  type JackpotPlayer,
} from '@/hooks/use-jackpot';
import { JackpotReel, type JackpotReveal } from './jackpot-reel';
import { useGameSound } from '@/components/instant/use-game-sound';
import { cn } from '@/lib/cn';

const QUICK = ['0.05', '0.25', '1', '5'];
const BAR_COLORS = ['#22d3ee', '#a855f7', '#f59e0b', '#34d399', '#f472b6', '#60a5fa'];

export function JackpotGame() {
  const snap = useJackpot();
  const { data: me } = useMe();
  const token = useAuthStore((s) => s.accessToken);
  const enter = useEnterJackpot();
  const sound = useGameSound();
  const socket = useSocket('/jackpot');
  const [amount, setAmount] = useState('0.25');
  const [error, setError] = useState<string | null>(null);

  // Winner reveal: capture the pot's players the instant before the draw,
  // then run the reel when the result event lands (the snapshot refetch wipes
  // the players list for the next round, so we freeze it here).
  const playersRef = useRef<JackpotPlayer[]>([]);
  const meIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    meIdRef.current = me?.id;
  }, [me?.id]);
  useEffect(() => {
    if (snap && snap.players.length) playersRef.current = snap.players;
  }, [snap]);

  const [reveal, setReveal] = useState<JackpotReveal | null>(null);
  useEffect(() => {
    if (!socket) return;
    const onResult = (p: {
      status: string;
      winnerId: string | null;
      winnerName: string | null;
      payoutLamports: string;
    }) => {
      if (p.status !== 'drawn' || !p.winnerId) return;
      const players = playersRef.current;
      if (!players.length) return;
      setReveal({
        players,
        winnerId: p.winnerId,
        winnerName: p.winnerName,
        payoutLamports: p.payoutLamports,
        meId: meIdRef.current,
      });
    };
    socket.on('jackpot:result', onResult);
    const logAny = (event: string) => console.debug('[jp socket]', event);
    socket.onAny(logAny);
    return () => {
      socket.off('jackpot:result', onResult);
      socket.offAny(logAny);
    };
  }, [socket]);
  const clearReveal = useCallback(() => setReveal(null), []);

  async function submit() {
    setError(null);
    const lamports = Math.floor(Number(amount) * 1e9);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      setError('Enter a valid amount');
      return;
    }
    sound.bet();
    try {
      await enter.mutateAsync(String(lamports));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to enter');
    }
  }

  const myChance = useMemo(() => {
    if (!snap || !me) return 0;
    const mine = snap.players.find((p) => p.userId === me.id);
    return mine ? mine.chance : 0;
  }, [snap, me]);

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4">
      <div className="space-y-4 min-w-0">
        {reveal ? <JackpotReel reveal={reveal} onDone={clearReveal} /> : <PotBanner snap={snap} />}

        <Card className="p-5 space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Coins className="h-4 w-4 text-primary-400" />
            Enter the pot
          </h3>

          <div className="relative">
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => {
                setError(null);
                setAmount(e.target.value);
              }}
              disabled={enter.isPending}
              className="w-full rounded-xl border border-border bg-surface-elevated pl-4 pr-16 h-12 text-lg font-mono focus:outline-none focus:border-primary-400 disabled:opacity-50"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-foreground-muted">
              SOL
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setError(null);
                  setAmount(q);
                }}
                className={cn(
                  'py-1.5 text-xs font-semibold rounded-lg border transition-colors',
                  amount === q
                    ? 'border-primary-400 bg-primary-400/10 text-primary-400'
                    : 'border-border bg-surface-elevated text-foreground-muted hover:text-foreground',
                )}
              >
                {q}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-foreground-muted">
            <span>
              {me ? (
                <>
                  Balance{' '}
                  <span className="font-mono text-foreground">
                    {formatSol(me.playBalanceLamports, 3)}
                  </span>
                </>
              ) : (
                'Connect to enter'
              )}
            </span>
            {myChance > 0 && (
              <span className="text-success font-semibold">
                Your win chance {(myChance * 100).toFixed(1)}%
              </span>
            )}
          </div>

          {token ? (
            <Button onClick={submit} size="lg" className="w-full" disabled={enter.isPending}>
              <Trophy className="h-5 w-5" />
              {enter.isPending ? 'Entering…' : `Enter with ${amount || '0'} SOL`}
            </Button>
          ) : (
            <div className="[&>button]:w-full">
              <ConnectButton />
            </div>
          )}
          <p className="text-[11px] text-foreground-muted text-center">
            Win chance = your stake ÷ total pot. Provably fair ·{' '}
            {snap ? Math.round(snap.config.houseEdge * 100) : 5}% platform edge · needs{' '}
            {snap?.config.minPlayers ?? 2}+ players or all entries refund.
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4 text-cyan-300" />
              In the pot
            </h3>
            <span className="text-xs text-foreground-muted">{snap?.playerCount ?? 0} players</span>
          </div>
          <PlayersList snap={snap} meId={me?.id} />
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="p-4">
          <h3 className="text-[10px] uppercase tracking-wider text-foreground-muted mb-3 font-semibold">
            My entries
          </h3>
          <MyEntries />
        </Card>
        <Card className="p-4">
          <h3 className="text-[10px] uppercase tracking-wider text-foreground-muted mb-3 font-semibold">
            Recent winners
          </h3>
          <RecentWinners />
        </Card>
        <JackpotFairness snap={snap} />
      </div>
    </div>
  );
}

function PotBanner({ snap }: { snap: JackpotSnapshot | null }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!snap) return;
    const update = () => setRemaining(Math.max(0, snap.closeAt - Date.now()));
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [snap?.closeAt, snap]);

  const secs = Math.ceil(remaining / 1000);
  const potSol = snap ? lamportsToSol(snap.totalLamports) : 0;
  const last = snap?.lastResult;

  return (
    <Card className="p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-primary-400/10 pointer-events-none" />
      <div className="relative text-center">
        <div className="text-[10px] uppercase tracking-[0.4em] text-amber-400/80 mb-2">
          Jackpot Pot
        </div>
        <div
          className="text-5xl md:text-7xl font-black tabular-nums leading-none"
          style={{ textShadow: '0 0 40px rgba(245,158,11,0.35)' }}
        >
          <span className="text-gradient">{potSol.toFixed(3)}</span>{' '}
          <span className="text-2xl md:text-4xl text-foreground-muted">SOL</span>
        </div>
        <div className="mt-3 text-sm text-foreground-muted">
          {snap ? (
            <>
              Drawing in <span className="font-mono font-bold text-foreground">{secs}s</span> ·{' '}
              {snap.playerCount} player{snap.playerCount === 1 ? '' : 's'}
            </>
          ) : (
            'Connecting…'
          )}
        </div>
      </div>

      {last && (
        <div className="relative mt-4 pt-4 border-t border-border flex items-center justify-center gap-2 text-sm">
          {last.status === 'drawn' ? (
            <>
              <Crown className="h-4 w-4 text-amber-400" />
              <span className="text-foreground-muted">Last winner</span>
              <span className="font-semibold">{last.winnerName ?? 'anon'}</span>
              <span className="text-success font-mono font-semibold">
                +{formatSol(last.payoutLamports, 3)}
              </span>
            </>
          ) : (
            <span className="text-foreground-muted">Last round refunded — not enough players.</span>
          )}
        </div>
      )}
    </Card>
  );
}

function PlayersList({ snap, meId }: { snap: JackpotSnapshot | null; meId?: string }) {
  if (!snap || snap.players.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-foreground-muted">
        No entries yet — be first in.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {snap.players.map((p, i) => {
        const isMe = p.userId === meId;
        const name = p.username ?? shortAddress(p.walletAddress);
        const color = BAR_COLORS[i % BAR_COLORS.length];
        return (
          <div key={p.userId} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className={cn('font-semibold truncate', isMe && 'text-primary-400')}>
                {name} {isMe && '(you)'}
              </span>
              <span className="font-mono text-foreground-muted">
                {formatSol(p.amountLamports, 3)} · {(p.chance * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-elevated overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(2, p.chance * 100)}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MyEntries() {
  const { data, isLoading } = useMyJackpot();
  if (isLoading)
    return <div className="py-6 text-center text-xs text-foreground-muted">Loading…</div>;
  if (!data || data.length === 0)
    return <div className="py-6 text-center text-xs text-foreground-muted">No entries yet.</div>;
  return (
    <div className="space-y-2">
      {data.map((r) => {
        const settled = r.status !== 'open';
        return (
          <div
            key={r.roundId}
            className={cn(
              'flex items-center justify-between px-3 py-2 rounded-lg text-xs border',
              r.won ? 'bg-success/10 border-success/40' : 'bg-surface-elevated/40 border-border',
            )}
          >
            <span className="font-mono">{formatSol(r.myAmountLamports, 3)}</span>
            <span>
              {!settled ? (
                <span className="text-foreground-muted">in pot</span>
              ) : r.won ? (
                <span className="text-success font-semibold">
                  won +{formatSol(r.payoutLamports, 3)}
                </span>
              ) : r.status === 'refunded' ? (
                <span className="text-foreground-muted">refunded</span>
              ) : (
                <span className="text-foreground-muted">no win</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RecentWinners() {
  const { data, isLoading } = useJackpotRecent();
  if (isLoading)
    return <div className="py-6 text-center text-xs text-foreground-muted">Loading…</div>;
  if (!data || data.length === 0)
    return <div className="py-6 text-center text-xs text-foreground-muted">No draws yet.</div>;
  return (
    <div className="space-y-2">
      {data.map((r) => {
        const verifyHref =
          `/fairness?game=jackpot&clientSeed=${encodeURIComponent(r.clientSeed)}` +
          `&nonce=${r.nonce}&commit=${r.serverSeedHash}` +
          (r.serverSeed ? `&serverSeed=${r.serverSeed}` : '');
        return (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-elevated/40 text-xs"
          >
            <div className="min-w-0">
              {r.status === 'drawn' ? (
                <>
                  <div className="font-semibold truncate">
                    {r.winnerName ?? (r.winnerWallet ? shortAddress(r.winnerWallet) : 'anon')}
                  </div>
                  <div className="text-success font-mono">+{formatSol(r.payoutLamports, 3)}</div>
                </>
              ) : (
                <div className="text-foreground-muted">refunded</div>
              )}
            </div>
            <Link
              href={verifyHref}
              className="text-foreground-muted hover:text-primary-400 shrink-0"
              title="Verify this draw"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        );
      })}
    </div>
  );
}

function JackpotFairness({ snap }: { snap: JackpotSnapshot | null }) {
  if (!snap) return null;
  const last = snap.lastResult;
  const verifyHref = last
    ? `/fairness?game=jackpot&clientSeed=${encodeURIComponent(last.clientSeed)}` +
      `&nonce=${last.nonce}&commit=${last.serverSeedHash}&serverSeed=${last.serverSeed}`
    : '/fairness';
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 space-y-3">
      <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foreground-muted font-semibold">
        <ShieldCheck className="h-3.5 w-3.5 text-success" />
        Provably Fair
      </h3>
      <SeedRow label="Current round — server seed (commit)" value={snap.serverSeedHash} />
      <SeedRow label="Client seed" value={snap.clientSeed} />
      {last && (
        <div className="pt-2 border-t border-border space-y-2">
          <SeedRow label="Last round — server seed (revealed)" value={last.serverSeed} />
          {last.winningTicket && (
            <div className="text-[10px] text-foreground-muted">
              Winning ticket <span className="font-mono text-foreground">{last.winningTicket}</span>{' '}
              of {last.totalLamports} lamports
            </div>
          )}
          <Link
            href={verifyHref}
            className="flex items-center justify-center gap-1.5 w-full rounded-lg border border-primary-400/40 bg-primary-400/10 py-2 text-xs font-semibold text-primary-400 hover:bg-primary-400/20 transition-colors"
          >
            Verify last round
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function SeedRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-foreground-muted/70 mb-0.5">
        {label}
      </div>
      <div className="font-mono text-[10px] break-all leading-tight text-foreground/90">
        {value}
      </div>
    </div>
  );
}
