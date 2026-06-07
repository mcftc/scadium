'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Coins, Crown, Gift, Ticket } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ConnectButton } from '@/components/wallet/connect-button';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/cn';
import { formatUsd } from '@/lib/format';
import {
  useFreeTickets,
  useMyLotteryStats,
  useMyLotteryTickets,
  type MyLotteryTicket,
} from '@/hooks/use-lottery';
import { LotteryBalls } from '../lottery-balls';

type Tab = 'active' | 'past' | 'wins';

/**
 * bc.game "My Bets" page: lifetime lottery stat cards, the free-ticket
 * loyalty banner (our 1-SOL-wagered = 1-ticket mechanic), and the
 * Active | Past | My Wins ticket lists.
 */
export function MyBets() {
  const token = useAuthStore((s) => s.accessToken);
  const stats = useMyLotteryStats();
  const [tab, setTab] = useState<Tab>('active');
  // "My Wins" queries with the server-side won filter — winning tickets can
  // fall outside the latest-50 window on big purchases.
  const tickets = useMyLotteryTickets(50, tab === 'wins');
  const freeTickets = useFreeTickets();

  if (!token) {
    return (
      <Card className="p-10 text-center space-y-3">
        <p className="text-sm text-foreground-muted">Connect your wallet to see your bets.</p>
        <div className="inline-block">
          <ConnectButton />
        </div>
      </Card>
    );
  }

  const all = tickets.data ?? [];
  const filtered = all.filter((t) =>
    tab === 'active' ? t.drawStatus === 'open' : tab === 'past' ? t.drawStatus === 'drawn' : true,
  );

  const progress = freeTickets.data
    ? Number(BigInt(freeTickets.data.progressLamports)) /
      Number(BigInt(freeTickets.data.perWagerLamports))
    : 0;

  return (
    <div className="space-y-4">
      <Link
        href="/lottery"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Lottery
      </Link>

      {/* Stat cards (bc.game: Total Bet / Total winning tickets / Total Winning Prize). */}
      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard
          label="Total Tickets"
          value={stats.data ? String(stats.data.totalTickets) : '—'}
          icon={<Ticket className="h-5 w-5 text-primary-400" />}
        />
        <StatCard
          label="Total winning tickets"
          value={stats.data ? String(stats.data.winningTickets) : '—'}
          icon={<Crown className="h-5 w-5 text-amber-400" />}
        />
        <StatCard
          label="Total Winning Prize"
          value={stats.data ? `${formatUsd(stats.data.totalPrizeUsd)}` : '—'}
          icon={<Coins className="h-5 w-5 text-success" />}
          valueClass="text-success"
        />
      </div>

      {/* Free-ticket loyalty banner (our mechanic: 1 SOL wagered = 1 ticket). */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-primary-400" />
            <span className="text-sm font-semibold">Free Lottery Tickets</span>
          </div>
          <span className="text-xs font-mono font-bold text-primary-300">
            {freeTickets.data?.available ?? 0} earned
          </span>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-surface overflow-hidden">
          <div
            className="h-full bg-primary-400 transition-all"
            style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
          />
        </div>
        <p className="mt-2 text-[10px] text-foreground-muted">
          Earn 1 free ticket for every 1 SOL wagered across all games —{' '}
          {Math.round(progress * 100)}% of the way to your next one.
        </p>
      </Card>

      {/* Active | Past | My Wins */}
      <div className="inline-flex gap-1 p-1 bg-background rounded-lg border border-border">
        {(
          [
            ['active', 'Active'],
            ['past', 'Past'],
            ['wins', 'My Wins'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'px-4 py-1.5 text-xs font-semibold rounded-md transition-colors',
              tab === key ? 'bg-surface-elevated text-foreground' : 'text-foreground-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="p-4">
        {tickets.isLoading ? (
          <div className="py-8 text-center text-xs text-foreground-muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-foreground-muted">
            {tab === 'active'
              ? 'No tickets in the current draw.'
              : tab === 'past'
                ? 'No settled tickets yet.'
                : 'No winning tickets yet — keep playing.'}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="hidden sm:grid grid-cols-[170px_1fr_110px_110px] gap-3 px-3 pb-2 text-[10px] uppercase tracking-wider text-foreground-muted">
              <span>Lottery</span>
              <span>Numbers</span>
              <span className="text-center">Results</span>
              <span className="text-right">Total Profit</span>
            </div>
            {filtered.map((t) => (
              <BetRow key={t.id} t={t} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function BetRow({ t }: { t: MyLotteryTicket }) {
  const settled = t.drawStatus === 'drawn';
  return (
    <div className="grid sm:grid-cols-[170px_1fr_110px_110px] grid-cols-1 gap-2 sm:gap-3 items-center rounded-lg bg-surface-elevated/40 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold">Scadium Lottery</div>
        <div className="text-[10px] font-mono text-foreground-muted">
          {t.gameNumber}
          {t.free ? ' · FREE' : ''}
        </div>
      </div>
      <LotteryBalls
        main={t.mainNumbers}
        bonus={t.bonusNumber}
        hits={settled ? t.drawMain : undefined}
        bonusHit={settled && t.matchedBonus > 0}
        size="sm"
      />
      <span className="text-xs font-mono sm:text-center">
        {settled ? (
          `${t.matchedMain} Matched${t.matchedBonus > 0 ? ' + bonus' : ''}`
        ) : (
          <span className="text-foreground-muted">pending</span>
        )}
      </span>
      <span
        className={cn(
          'text-xs font-mono font-bold sm:text-right',
          settled && t.won ? 'text-success' : 'text-foreground-muted',
        )}
      >
        {settled ? formatUsd(t.payoutUsd) : '—'}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  valueClass,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <Card className="p-4 flex items-center justify-between gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-foreground-muted mb-1">
          {label}
        </div>
        <div className={cn('text-xl font-black font-mono tabular-nums', valueClass)}>{value}</div>
      </div>
      {icon}
    </Card>
  );
}
