'use client';

import { useEffect, useMemo, useState } from 'react';
import { Ticket, Clock, Shuffle, Trophy, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConnectButton } from '@/components/wallet/connect-button';
import { useAuthStore } from '@/store/auth-store';
import { formatUsd } from '@/lib/format';
import {
  useLottery,
  useBuyTicket,
  useBuyBulkTickets,
  useUsdtBalance,
  useUsdtFaucet,
  useFreeTickets,
  useUseFreeTicket,
  type TicketPicks,
} from '@/hooks/use-lottery';
import { NumberPicker } from './number-picker';
import { PrizeTable } from './prize-table';
import { MyTickets } from './my-tickets';
import { RecentDraws } from './recent-draws';
import { LotteryFairness } from './lottery-fairness';
import { LotteryBalls } from './lottery-balls';

export function LotteryGame() {
  const snap = useLottery();
  const token = useAuthStore((s) => s.accessToken);
  const buyTicket = useBuyTicket(snap);
  const buyBulk = useBuyBulkTickets(snap);
  const usdtBalance = useUsdtBalance(snap);
  const faucet = useUsdtFaucet();
  const freeTickets = useFreeTickets();
  const useFree = useUseFreeTicket();

  const [main, setMain] = useState<number[]>([]);
  const [bonus, setBonus] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const mainCount = snap?.config.mainCount ?? 5;
  const mainMax = snap?.config.mainMax ?? 36;
  const bonusMax = snap?.config.bonusMax ?? 10;
  const ready = main.length === mainCount && bonus !== null;

  function toggleMain(n: number) {
    setError(null);
    setMain((cur) =>
      cur.includes(n) ? cur.filter((x) => x !== n) : cur.length < mainCount ? [...cur, n] : cur,
    );
  }

  function randomPicks(): TicketPicks {
    const pool = Array.from({ length: mainMax }, (_, i) => i + 1);
    const picks: number[] = [];
    for (let i = 0; i < mainCount; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(idx, 1)[0]!);
    }
    return {
      mainNumbers: picks.sort((a, b) => a - b),
      bonusNumber: Math.floor(Math.random() * bonusMax) + 1,
    };
  }

  function quickPick() {
    setError(null);
    const t = randomPicks();
    setMain(t.mainNumbers);
    setBonus(t.bonusNumber);
  }

  /**
   * Bulk auto-pick purchase: N distinct random tickets in one go (combos
   * deduped within the batch). No per-draw cap — the only guard is a UI
   * sanity limit per click.
   */
  async function buyBulkTickets(count: number) {
    setError(null);
    const maxBulk = snap?.config.maxBulkPerSubmit ?? 200;
    if (count > maxBulk) {
      setError(`Max ${maxBulk} tickets per purchase`);
      return;
    }
    const seen = new Set<string>();
    const tickets: TicketPicks[] = [];
    while (tickets.length < count) {
      const t = randomPicks();
      const key = `${t.mainNumbers.join(',')}:${t.bonusNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tickets.push(t);
    }
    const totalUsd = count * priceUsd;
    if (onChain && usdtBal != null && usdtBal < totalUsd) {
      setError(
        `Insufficient USDT — ${count} tickets cost ${formatUsd(totalUsd)} USDT, you have ${formatUsd(usdtBal)}`,
      );
      return;
    }
    setBulkProgress({ done: 0, total: count });
    try {
      await buyBulk.mutateAsync({
        tickets,
        onProgress: (done) => setBulkProgress({ done, total: count }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk purchase failed');
    } finally {
      setBulkProgress(null);
    }
  }

  async function submit() {
    if (!ready) return;
    setError(null);
    try {
      await buyTicket.mutateAsync({ mainNumbers: main, bonusNumber: bonus! });
      setMain([]);
      setBonus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to buy ticket');
    }
  }

  const priceUsd = snap?.ticketPriceUsd ?? 0;
  const onChain = !!snap?.chain.enabled;
  const usdtBal = usdtBalance.data ? Number(BigInt(usdtBalance.data)) / 1e6 : null;

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4">
      {/* LEFT: draw + picker */}
      <div className="space-y-4 min-w-0">
        <DrawHeader snap={snap} />

        <Card className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Ticket className="h-4 w-4 text-primary-400" />
              Your ticket
            </h3>
            <button
              type="button"
              onClick={quickPick}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary-400 hover:text-primary-300 transition-colors"
            >
              <Shuffle className="h-3.5 w-3.5" />
              Quick pick
            </button>
          </div>

          <NumberPicker
            mainMax={mainMax}
            mainCount={mainCount}
            bonusMax={bonusMax}
            main={main}
            bonus={bonus}
            onToggleMain={toggleMain}
            onPickBonus={(n) => {
              setError(null);
              setBonus(n);
            }}
            disabled={buyTicket.isPending}
          />

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <div className="text-xs text-foreground-muted">
              Ticket price{' '}
              <span className="font-mono text-foreground">{formatUsd(priceUsd)} USDT</span>
              {onChain && usdtBal != null && (
                <span className="ml-2 text-foreground-muted/70">
                  · balance <span className="font-mono">{formatUsd(usdtBal)} USDT</span>
                </span>
              )}
            </div>
            {onChain && token && (usdtBal ?? 0) < priceUsd && (
              <button
                type="button"
                onClick={() => faucet.mutate()}
                disabled={faucet.isPending}
                className="text-xs font-semibold text-primary-400 hover:text-primary-300 disabled:opacity-50"
              >
                {faucet.isPending ? 'Sending…' : 'Get 10 USDT (devnet)'}
              </button>
            )}
          </div>

          {token ? (
            <div className="space-y-2">
              <Button
                onClick={submit}
                size="lg"
                className="w-full"
                disabled={!ready || buyTicket.isPending || useFree.isPending || buyBulk.isPending}
              >
                <Ticket className="h-5 w-5" />
                {buyTicket.isPending
                  ? 'Buying…'
                  : ready
                    ? `Buy ticket · ${formatUsd(priceUsd)} USDT`
                    : `Pick ${mainCount} + bonus`}
              </Button>

              {/* Bulk auto-pick: N random tickets in one go, one wallet approval. */}
              <div className="flex items-center gap-2 pt-1">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] uppercase tracking-wider text-foreground-muted">
                  or auto-pick in bulk
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              {bulkProgress ? (
                <div className="w-full rounded-xl border border-primary-400/40 bg-primary-400/10 px-3 py-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-primary-300">
                    <span className="flex items-center gap-1.5">
                      <Shuffle className="h-3.5 w-3.5 animate-pulse" />
                      Buying {bulkProgress.done}/{bulkProgress.total} tickets…
                    </span>
                    <span className="font-mono">
                      {Math.round((bulkProgress.done / bulkProgress.total) * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full bg-primary-400 transition-all duration-200"
                      style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {(snap?.config.ticketPresets ?? [20, 50, 100]).map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={buyBulk.isPending || buyTicket.isPending || useFree.isPending}
                      onClick={() => buyBulkTickets(n)}
                      className="rounded-xl border border-border bg-surface-elevated px-2 py-2.5 text-center transition-colors hover:border-primary-400/50 hover:bg-surface disabled:opacity-50"
                    >
                      <div className="text-sm font-bold">{n}× tickets</div>
                      <div className="text-[10px] text-foreground-muted font-mono">
                        {formatUsd(n * priceUsd)} USDT
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {(freeTickets.data?.available ?? 0) > 0 && (
                <button
                  type="button"
                  disabled={!ready || useFree.isPending || buyTicket.isPending || buyBulk.isPending}
                  onClick={async () => {
                    if (!ready) return;
                    setError(null);
                    try {
                      await useFree.mutateAsync({ mainNumbers: main, bonusNumber: bonus! });
                      setMain([]);
                      setBonus(null);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Failed to use free ticket');
                    }
                  }}
                  className="w-full py-2.5 rounded-xl border border-primary-400/50 bg-primary-400/10 text-primary-300 text-sm font-bold disabled:opacity-50 hover:bg-primary-400/20 transition-colors"
                >
                  {useFree.isPending
                    ? 'Using…'
                    : `Use FREE ticket (${freeTickets.data!.available} earned)`}
                </button>
              )}
              <p className="text-[10px] text-foreground-muted text-center">
                Earn 1 free ticket for every 1 SOL wagered across all games.
              </p>
            </div>
          ) : (
            <div className="[&>button]:w-full">
              <ConnectButton />
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <Trophy className="h-4 w-4 text-amber-400" />
            Prize tiers
          </h3>
          <PrizeTable snap={snap} />
          <p className="mt-3 text-[11px] text-foreground-muted">
            Fixed USDT prizes, bc.game rules — the bonus only matters for the grand prize.
            Every draw is provably fair — numbers are committed before tickets open.
          </p>
        </Card>
      </div>

      {/* RIGHT: tickets, recent, fairness */}
      <div className="space-y-4">
        <Card className="p-4">
          <h3 className="text-[10px] uppercase tracking-wider text-foreground-muted mb-3 font-semibold">
            My tickets
          </h3>
          <MyTickets priceUsd={priceUsd} />
        </Card>
        <Card className="p-4">
          <h3 className="text-[10px] uppercase tracking-wider text-foreground-muted mb-3 font-semibold">
            Recent draws
          </h3>
          <RecentDraws />
        </Card>
        <LotteryFairness snap={snap} />
      </div>
    </div>
  );
}

/** Big draw banner: countdown, pot, ticket count, last result. */
function DrawHeader({ snap }: { snap: ReturnType<typeof useLottery> }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!snap) return;
    const update = () => setRemaining(Math.max(0, snap.drawAt - Date.now()));
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [snap?.drawAt, snap]);

  // Draws are hours apart (twice a day), so roll up to h:mm:ss past the hour.
  const countdown = useMemo(() => {
    const s = Math.ceil(remaining / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }, [remaining]);

  // Wall-clock time of the draw, derived from the API snapshot (the client
  // bundle can't import runtime values from @scadium/shared).
  const drawTime = useMemo(
    () =>
      snap
        ? new Date(snap.drawAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        : null,
    [snap],
  );

  return (
    <Card className="p-5 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-primary-400/10 via-transparent to-amber-400/5 pointer-events-none" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-foreground-muted mb-1">
            Next draw in
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary-400" />
            <span className="text-4xl font-black font-mono tabular-nums">
              {snap ? countdown : '—:—'}
            </span>
          </div>
          {drawTime && (
            <div className="mt-1 text-[11px] text-foreground-muted">draws at {drawTime}</div>
          )}
        </div>

        <div className="flex items-center gap-6">
          <Stat
            label="Pot"
            value={snap ? `${formatUsd(snap.ticketCount * snap.ticketPriceUsd)} USDT` : '—'}
          />
          <Stat
            label="Tickets"
            value={snap ? String(snap.ticketCount) : '—'}
            icon={<Users className="h-3 w-3" />}
          />
        </div>
      </div>

      {snap?.lastResult && (
        <div className="relative mt-4 pt-4 border-t border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
            Last draw
          </div>
          <LotteryBalls
            main={snap.lastResult.mainNumbers}
            bonus={snap.lastResult.bonusNumber}
            size="sm"
          />
          <div className="text-[10px] text-foreground-muted">
            {snap.lastResult.winnersCount} winner{snap.lastResult.winnersCount === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="text-right">
      <div className="flex items-center gap-1 justify-end text-[10px] uppercase tracking-wider text-foreground-muted mb-1">
        {icon}
        {label}
      </div>
      <div className="text-lg font-bold font-mono tabular-nums">{value}</div>
    </div>
  );
}
