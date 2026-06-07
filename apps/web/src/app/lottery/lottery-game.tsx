'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ticket, Shuffle, Trophy } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConnectButton } from '@/components/wallet/connect-button';
import { useAuthStore } from '@/store/auth-store';
import { formatUsd } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  useLottery,
  useBuyBulkTickets,
  useUsdtBalance,
  useUsdtFaucet,
  useFreeTickets,
  useUseFreeTicket,
  type TicketPicks,
} from '@/hooks/use-lottery';
import { TicketListBuilder, isCompleteTicket, type TicketRow } from './ticket-list-builder';
import { LotteryPageHeader } from './lottery-page-header';
import { ResultsTab } from './results-tab';
import { JackpotWinnersTab } from './jackpot-winners-tab';
import { PrizeTable } from './prize-table';
import { MyTickets } from './my-tickets';
import { LotteryFairness } from './lottery-fairness';

const EMPTY_ROW: TicketRow = { main: [], bonus: null };

type Tab = 'buy' | 'results' | 'jackpot';

export function LotteryGame() {
  const snap = useLottery();
  const [tab, setTab] = useState<Tab>('buy');

  return (
    <div className="space-y-4">
      <LotteryPageHeader snap={snap} />

      {/* bc.game tabs: Buy Lottery | Results | Jackpot Winners */}
      <div className="inline-flex gap-1 p-1 bg-background rounded-lg border border-border">
        <TabButton active={tab === 'buy'} onClick={() => setTab('buy')}>
          Buy Lottery
        </TabButton>
        <TabButton active={tab === 'results'} onClick={() => setTab('results')}>
          Results
        </TabButton>
        <TabButton active={tab === 'jackpot'} onClick={() => setTab('jackpot')}>
          Jackpot Winners
        </TabButton>
      </div>

      {tab === 'buy' && <BuyTab snap={snap} />}
      {tab === 'results' && <ResultsTab />}
      {tab === 'jackpot' && <JackpotWinnersTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-4 py-1.5 text-xs font-semibold rounded-md transition-colors',
        active ? 'bg-surface-elevated text-foreground' : 'text-foreground-muted',
      )}
    >
      {children}
    </button>
  );
}

function BuyTab({ snap }: { snap: ReturnType<typeof useLottery> }) {
  const token = useAuthStore((s) => s.accessToken);
  const buyBulk = useBuyBulkTickets(snap);
  const usdtBalance = useUsdtBalance(snap);
  const faucet = useUsdtFaucet();
  const freeTickets = useFreeTickets();
  const useFree = useUseFreeTicket();
  const qc = useQueryClient();

  const mainCount = snap?.config.mainCount ?? 5;
  const mainMax = snap?.config.mainMax ?? 36;
  const bonusMax = snap?.config.bonusMax ?? 10;
  const maxManualRows = snap?.config.maxManualRows ?? 10;
  const perTx = snap?.config.batchTicketsPerTx ?? 12;

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

  function randomRow(): TicketRow {
    const t = randomPicks();
    return { main: t.mainNumbers, bonus: t.bonusNumber };
  }

  // bc.game ticket list: up to `maxManualRows` always-open picker cards;
  // anything beyond is bought as auto-generated random tickets. Cards start
  // EMPTY ("Completed 0/N") — Quick Pick fills them. Empty init is also what
  // keeps SSR hydration deterministic (no Math.random on first render).
  const [tickets, setTickets] = useState<TicketRow[]>([EMPTY_ROW]);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const manualCount = Math.min(quantity, maxManualRows);
  const autoCount = Math.max(0, quantity - maxManualRows);

  // Keep the card array in lockstep with the quantity: grow with EMPTY cards
  // (bc.game starts blank), trim from the end when the quantity shrinks.
  // tickets.length is a dep so deleting a card while autoCount > 0 backfills.
  useEffect(() => {
    setTickets((cur) => {
      if (cur.length === manualCount) return cur;
      if (cur.length > manualCount) return cur.slice(0, manualCount);
      const next = [...cur];
      while (next.length < manualCount) next.push(EMPTY_ROW);
      return next;
    });
  }, [manualCount, tickets.length]);

  function setQty(n: number) {
    setError(null);
    setNotice(null);
    setQuantity(Math.max(1, Math.floor(n)));
  }

  function updateRow(i: number, patch: (t: TicketRow) => TicketRow) {
    setError(null);
    setTickets((cur) => cur.map((t, idx) => (idx === i ? patch(t) : t)));
  }

  const completedCount = tickets.filter((t) => isCompleteTicket(t, mainCount)).length;
  const allComplete = completedCount === tickets.length;
  const firstRow = tickets[0];
  const firstRowReady = firstRow != null && isCompleteTicket(firstRow, mainCount);

  const priceUsd = snap?.ticketPriceUsd ?? 0;
  const onChain = !!snap?.chain.enabled;
  const usdtBal = usdtBalance.data ? Number(BigInt(usdtBalance.data)) / 1e6 : null;
  const totalUsd = quantity * priceUsd;
  const txCount = Math.ceil(quantity / perTx);

  /**
   * Buy everything in one go: the visible cards verbatim plus
   * (quantity − cards) auto-generated random tickets deduped against the
   * manual picks and each other. No quantity cap (bc.game parity).
   */
  async function buyAll() {
    setError(null);
    setNotice(null);
    if (!allComplete) {
      setError(`Complete every ticket — pick ${mainCount} numbers + Jackpot Ball on each card`);
      return;
    }
    const seen = new Set<string>();
    const picks: TicketPicks[] = [];
    for (const t of tickets) {
      const main = [...t.main].sort((a, b) => a - b);
      seen.add(`${main.join(',')}:${t.bonus}`);
      picks.push({ mainNumbers: main, bonusNumber: t.bonus! });
    }
    while (picks.length < quantity) {
      const t = randomPicks();
      const key = `${t.mainNumbers.join(',')}:${t.bonusNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(t);
    }
    if (onChain && usdtBal != null && usdtBal < totalUsd) {
      setError(
        `Insufficient USDT — ${quantity} tickets cost ${formatUsd(totalUsd)} USDT, you have ${formatUsd(usdtBal)}`,
      );
      return;
    }
    let progressDone = 0;
    setBulkProgress({ done: 0, total: quantity });
    try {
      await buyBulk.mutateAsync({
        tickets: picks,
        onProgress: (done) => {
          progressDone = done;
          setBulkProgress({ done, total: quantity });
        },
      });
      // Reset first — setQty clears the notice, so the message comes last.
      setQty(1);
      setTickets([EMPTY_ROW]);
      setNotice(`Bought ${quantity} ticket${quantity === 1 ? '' : 's'} — good luck!`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Purchase failed';
      // Chunks confirm independently — anything already confirmed IS bought.
      setError(
        progressDone > 0
          ? `Bought ${progressDone}/${quantity} tickets before the wallet stopped — the rest were not charged. (${msg})`
          : msg,
      );
      if (progressDone > 0) {
        qc.invalidateQueries({ queryKey: ['lottery', 'my-tickets'] });
        qc.invalidateQueries({ queryKey: ['lottery', 'usdt'] });
        qc.invalidateQueries({ queryKey: ['me'] });
      }
    } finally {
      setBulkProgress(null);
    }
  }

  async function spendFreeTicket() {
    if (!firstRowReady) return;
    setError(null);
    setNotice(null);
    try {
      await useFree.mutateAsync({
        mainNumbers: [...firstRow!.main].sort((a, b) => a - b),
        bonusNumber: firstRow!.bonus!,
      });
      updateRow(0, () => EMPTY_ROW);
      setNotice('Free ticket entered with your first card picks');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to use free ticket');
    }
  }

  const busy = buyBulk.isPending || useFree.isPending;

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4">
      {/* LEFT: ticket builder + bet slip */}
      <div className="space-y-4 min-w-0">
        <Card className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Ticket className="h-4 w-4 text-primary-400" />
              Ticket Numbers
            </h3>
            <div className="text-xs text-foreground-muted">
              1 Ticket = <span className="font-mono text-foreground">{formatUsd(priceUsd)}</span>
            </div>
          </div>

          <TicketListBuilder
            tickets={tickets}
            quantity={quantity}
            autoCount={autoCount}
            completedCount={completedCount}
            maxManualRows={maxManualRows}
            mainCount={mainCount}
            mainMax={mainMax}
            bonusMax={bonusMax}
            priceUsd={priceUsd}
            presets={snap?.config.ticketPresets ?? [5, 10, 20, 50]}
            disabled={busy}
            onSetQuantity={setQty}
            onAddRow={() => setQty(quantity + 1)}
            onRemoveRow={(i) => {
              setTickets((cur) => cur.filter((_, idx) => idx !== i));
              setQty(quantity - 1);
            }}
            onRerollRow={(i) => updateRow(i, () => randomRow())}
            onClearRow={(i) => updateRow(i, () => EMPTY_ROW)}
            onClearAll={() => {
              setError(null);
              setTickets((cur) => cur.map(() => EMPTY_ROW));
            }}
            onQuickPickAll={() => {
              setError(null);
              setTickets((cur) => cur.map(() => randomRow()));
            }}
            onToggleMain={(i, n) =>
              updateRow(i, (t) => ({
                ...t,
                main: t.main.includes(n)
                  ? t.main.filter((x) => x !== n)
                  : t.main.length < mainCount
                    ? [...t.main, n]
                    : t.main,
              }))
            }
            onPickBonus={(i, n) => updateRow(i, (t) => ({ ...t, bonus: n }))}
          />

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              {notice}
            </div>
          )}

          {/* Bet slip (bc.game: "N Tickets · $0.1 × N · Total Bet Amount"). */}
          <div className="rounded-xl border border-border bg-surface-elevated/60 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground-muted">Tickets</span>
              <span className="font-mono font-bold">{quantity}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground-muted">Price</span>
              <span className="font-mono">
                {formatUsd(priceUsd)} × {quantity}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
              <span className="text-foreground-muted">Total Bet Amount</span>
              <span className="font-mono font-bold text-foreground">
                {formatUsd(totalUsd)} USDT
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="text-foreground-muted">
                {onChain && usdtBal != null && (
                  <span>
                    Balance{' '}
                    <span className="font-mono text-foreground">{formatUsd(usdtBal)} USDT</span>
                  </span>
                )}
              </div>
              {onChain && token && (usdtBal ?? 0) < totalUsd && (
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
                  <Button
                    onClick={buyAll}
                    size="lg"
                    className="w-full"
                    disabled={!allComplete || busy}
                  >
                    <Ticket className="h-5 w-5" />
                    {allComplete
                      ? `Buy ${quantity} ticket${quantity === 1 ? '' : 's'} · ${formatUsd(totalUsd)} USDT`
                      : `Complete ${tickets.length - completedCount} more ticket${tickets.length - completedCount === 1 ? '' : 's'}`}
                  </Button>
                )}
                {onChain && txCount > 1 && !bulkProgress && (
                  <p className="text-[10px] text-foreground-muted text-center">
                    Signed in {txCount} batches of up to {perTx} tickets — one wallet approval.
                  </p>
                )}
                {(freeTickets.data?.available ?? 0) > 0 && (
                  <button
                    type="button"
                    disabled={!firstRowReady || busy}
                    onClick={spendFreeTicket}
                    className="w-full py-2.5 rounded-xl border border-primary-400/50 bg-primary-400/10 text-primary-300 text-sm font-bold disabled:opacity-50 hover:bg-primary-400/20 transition-colors"
                  >
                    {useFree.isPending
                      ? 'Using…'
                      : `Use FREE ticket (${freeTickets.data!.available} earned) — plays card #1`}
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
          </div>
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

      {/* RIGHT: this draw's tickets + fairness */}
      <div className="space-y-4">
        <Card className="p-4">
          <h3 className="text-[10px] uppercase tracking-wider text-foreground-muted mb-3 font-semibold">
            My tickets (this draw)
          </h3>
          <MyTickets onlyOpen />
        </Card>
        <LotteryFairness snap={snap} />
      </div>
    </div>
  );
}
