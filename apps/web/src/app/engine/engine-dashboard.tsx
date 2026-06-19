'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Flame, Lock, TrendingUp, Wallet, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

// $SCAD has 9 decimals, USDS has 6 — all amounts arrive as base-unit strings.
const SCAD_DECIMALS = 9;
const USDS_DECIMALS = 6;
const fmt = (base: string, decimals: number, dp = 2) =>
  (Number(BigInt(base)) / 10 ** decimals).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
const scad = (b: string, dp = 2) => fmt(b, SCAD_DECIMALS, dp);
const usds = (b: string, dp = 2) => `$${fmt(b, USDS_DECIMALS, dp)}`;

interface EngineSummary {
  totalStakedScad: string;
  totalBurnedScad: string;
  totalDistributedUsds: string;
  dividendNgrBps: number;
  buybackNgrBps: number;
  distributionIntervalMs: number;
  lastRound: { period: string; poolUsds: string; participantCount: number; distributedAt: string | null } | null;
}

interface StakingSummary {
  spendableScad: string;
  stakedScad: string;
  locked: boolean;
  lockedUntil: string | null;
  usdsBalance: string;
  usdsReserved: string;
  totalUsdsEarned: string;
  estApyPct: number;
  lockPeriodMs: number;
}

interface Round {
  period: string;
  ngrLamports: string;
  poolUsds: string;
  totalStakedSnapshot: string;
  participantCount: number;
  distributedAt: string | null;
}

export function EngineDashboard() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();

  const stats = useQuery({
    queryKey: ['engine', 'summary'],
    queryFn: () => api<EngineSummary>('/engine/summary'),
    refetchInterval: 30_000,
  });
  const rounds = useQuery({
    queryKey: ['engine', 'rounds'],
    queryFn: () => api<Round[]>('/engine/rounds?limit=30'),
    refetchInterval: 30_000,
  });
  const staking = useQuery({
    queryKey: ['staking', 'summary'],
    queryFn: () => api<StakingSummary>('/staking/summary', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['staking'] });
    qc.invalidateQueries({ queryKey: ['engine'] });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <FlowDiagram />

      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Total staked" value={stats.data ? `${scad(stats.data.totalStakedScad, 0)} SCAD` : '…'} icon={Lock} />
        <Stat label="USDS distributed" value={stats.data ? usds(stats.data.totalDistributedUsds) : '…'} icon={Coins} />
        <Stat label="$SCAD burned" value={stats.data ? `${scad(stats.data.totalBurnedScad, 0)}` : '…'} icon={Flame} />
      </div>

      {token ? (
        <StakePanel summary={staking.data} onChange={invalidate} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-foreground-muted text-sm">
            Connect your wallet to stake $SCAD and earn USDS dividends.
          </CardContent>
        </Card>
      )}

      <RoundsTable rounds={rounds.data} loading={rounds.isLoading} />

      {stats.data && (
        <p className="text-center text-xs text-foreground-muted">
          {(stats.data.dividendNgrBps / 100).toFixed(0)}% of house profit → stakers ·{' '}
          {(stats.data.buybackNgrBps / 100).toFixed(0)}% → buy &amp; burn · paid hourly in USDS
        </p>
      )}
    </div>
  );
}

function FlowDiagram() {
  const steps = [
    { label: 'Play any game', icon: Zap },
    { label: 'Earn $SCAD', icon: Coins },
    { label: 'Stake (locked)', icon: Lock },
    { label: 'Earn USDS', icon: Wallet },
  ];
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-2 py-6 overflow-x-auto">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col items-center gap-2">
              <div className="h-11 w-11 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow-sm">
                <s.icon className="h-5 w-5 text-white" />
              </div>
              <span className="text-[11px] text-foreground-muted whitespace-nowrap">{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className="text-foreground-muted">→</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Coins }) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center gap-2 text-foreground-muted text-xs uppercase tracking-wider">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className="mt-2 text-2xl font-bold font-mono">{value}</div>
      </CardContent>
    </Card>
  );
}

function StakePanel({ summary, onChange }: { summary: StakingSummary | undefined; onChange: () => void }) {
  const token = useAuthStore((s) => s.accessToken);
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // amount is shown in whole SCAD; convert to base units (9 decimals) for the API.
  const toBase = (whole: string): string => {
    const n = Number(whole);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Enter a valid amount');
    return BigInt(Math.round(n * 10 ** SCAD_DECIMALS)).toString();
  };

  const run = (path: string, body?: Record<string, unknown>) =>
    api(path, { method: 'POST', token, body });

  const stake = useMutation({
    mutationFn: () => run('/staking/stake', { amount: toBase(amount) }),
    onSuccess: () => { setAmount(''); setErr(null); onChange(); },
    onError: (e: Error) => setErr(e.message),
  });
  const unstake = useMutation({
    mutationFn: () => run('/staking/unstake', { amount: toBase(amount) }),
    onSuccess: () => { setAmount(''); setErr(null); onChange(); },
    onError: (e: Error) => setErr(e.message),
  });
  const stakeAll = useMutation({
    mutationFn: () => run('/staking/claim-and-stake'),
    onSuccess: () => { setErr(null); onChange(); },
    onError: (e: Error) => setErr(e.message),
  });
  const claimUsds = useMutation({
    mutationFn: () => run('/rewards/claim', { kind: 'dividend' }),
    onSuccess: () => { setErr(null); onChange(); },
    onError: (e: Error) => setErr(e.message),
  });

  const busy = stake.isPending || unstake.isPending || stakeAll.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your stake</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Spendable $SCAD" value={summary ? scad(summary.spendableScad) : '…'} />
          <Field label="Staked $SCAD" value={summary ? scad(summary.stakedScad) : '…'} />
          <Field label="USDS earned" value={summary ? usds(summary.totalUsdsEarned) : '…'} />
          <Field label="Est. APY" value={summary ? `${summary.estApyPct.toFixed(1)}%` : '…'} />
        </div>

        {summary?.locked && summary.lockedUntil && (
          <div className="flex items-center gap-2 text-xs text-warning">
            <Lock className="h-3.5 w-3.5" />
            Locked until {new Date(summary.lockedUntil).toLocaleString()}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount in SCAD"
            className="flex-1 rounded-xl border border-border bg-surface-elevated px-4 py-3 font-mono text-sm focus:border-primary-400 outline-none"
          />
          <Button variant="primary" disabled={busy || !amount} onClick={() => stake.mutate()}>
            Stake
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !amount || summary?.locked}
            onClick={() => unstake.mutate()}
          >
            Unstake
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => stakeAll.mutate()}>
            Stake all earned $SCAD
          </Button>
          <Button
            variant="outline"
            disabled={claimUsds.isPending || !summary || BigInt(summary.usdsBalance) <= 0n}
            onClick={() => claimUsds.mutate()}
          >
            Claim {summary ? usds(summary.usdsBalance) : '$0.00'} USDS
          </Button>
        </div>

        {err && <p className="text-xs text-danger">{err}</p>}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-foreground-muted">{label}</div>
      <div className="mt-1 font-bold font-mono">{value}</div>
    </div>
  );
}

function RoundsTable({ rounds, loading }: { rounds: Round[] | undefined; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary-400" />
        <CardTitle>Distribution rounds</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="py-12 text-center text-foreground-muted text-sm">Loading…</div>
        ) : !rounds || rounds.length === 0 ? (
          <div className="py-12 text-center text-foreground-muted text-sm">
            No rounds distributed yet.
          </div>
        ) : (
          <div>
            <div className="flex px-6 py-2 text-[10px] uppercase tracking-wider text-foreground-muted border-b border-border/40">
              <span className="flex-1">Round</span>
              <span className="w-28 text-right">USDS pool</span>
              <span className="w-20 text-right">Stakers</span>
            </div>
            {rounds.map((r) => (
              <div
                key={r.period}
                className="flex items-center px-6 py-3 border-b border-border/30 last:border-0 text-sm"
              >
                <span className="flex-1 font-mono">
                  #{r.period}
                  {r.distributedAt && (
                    <span className="ml-2 text-[10px] text-foreground-muted">
                      {new Date(r.distributedAt).toLocaleString()}
                    </span>
                  )}
                </span>
                <span className="w-28 text-right font-mono font-bold">{usds(r.poolUsds)}</span>
                <span className="w-20 text-right text-foreground-muted">{r.participantCount}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
