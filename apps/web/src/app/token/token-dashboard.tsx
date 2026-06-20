'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Flame,
  Coins,
  TrendingUp,
  Droplets,
  ExternalLink,
  ArrowRight,
  Gem,
  PieChart,
  Sparkles,
} from 'lucide-react';
import { SCAD } from '@scadium/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { solscanToken, solscanTx } from '@/lib/explorer';

const TOTAL_SUPPLY = SCAD.TOTAL_SUPPLY;

interface PoolInfo {
  enabled: boolean;
  scadMint?: string;
  priceUsd?: number;
  tvlUsd?: number;
}
interface BurnRow {
  id: string;
  scadBurned: string;
  solSpent: string;
  burnSignature: string | null;
  createdAt: string;
}
interface BurnsResponse {
  totalBurned: string;
  burns: BurnRow[];
}
interface AllocSlice {
  key: string;
  label: string;
  fraction: number;
  whole: number;
}
interface TokenStats {
  totalSupply: number;
  decimals: number;
  totalEmittedScad: string;
  p2ePoolBase: string;
  currentPhase: number;
  phaseCount: number;
  currentRatePerLamport: number;
  toNextHalvingBase: string;
  totalBurnedScad: string;
  totalDistributedUsds: string;
  allocation: AllocSlice[];
}

// Distinct tints for the six allocation slices (dark-theme friendly).
const ALLOC_COLORS: Record<string, string> = {
  p2e: '#22c55e',
  community: '#38bdf8',
  liquidity: '#a78bfa',
  treasury: '#f59e0b',
  team: '#f472b6',
  strategic: '#64748b',
};

const toWhole = (base: string | bigint) => Number(BigInt(base)) / 10 ** SCAD.DECIMALS;
const fmtNum = (n: number, max = 2) => n.toLocaleString(undefined, { maximumFractionDigits: max });
const shortSig = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const relTime = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Live stats + tokenomics + buy-and-burn feed for the $SCAD token page. */
export function TokenDashboard() {
  const pool = useQuery({
    queryKey: ['swap', 'pool'],
    queryFn: () => api<PoolInfo>('/swap/pool'),
    refetchInterval: 15_000,
  });
  const burns = useQuery({
    queryKey: ['swap', 'burns'],
    queryFn: () => api<BurnsResponse>('/swap/burns?limit=100'),
    refetchInterval: 60_000,
  });
  const stats = useQuery({
    queryKey: ['token', 'stats'],
    queryFn: () => api<TokenStats>('/token/stats'),
    refetchInterval: 30_000, // matches the engine dashboard poll
  });

  const enabled = pool.data?.enabled ?? false;
  const price = enabled ? (pool.data?.priceUsd ?? null) : null;
  const burnedWhole = burns.data ? toWhole(burns.data.totalBurned) : null;
  const circulating = burnedWhole != null ? TOTAL_SUPPLY - burnedWhole : null;
  const marketCap = price != null && circulating != null ? price * circulating : null;

  const rows = burns.data?.burns ?? [];
  // eslint-disable-next-line react-hooks/purity -- snapshots the wall clock once to tally burns from the last 24h; a render-time read of "now" is the intended semantics (display-only stat, no money/fairness).
  const now24h = Date.now();
  const burned24h = rows
    .filter((b) => now24h - new Date(b.createdAt).getTime() < 86_400_000)
    .reduce((s, b) => s + toWhole(b.scadBurned), 0);
  // Cumulative burned over time (chronological) for the area chart.
  const chrono = [...rows].reverse();
  const cumulative: number[] = [];
  let run = 0;
  for (const b of chrono) {
    run += toWhole(b.scadBurned);
    cumulative.push(run);
  }

  const offDash = pool.isLoading ? '…' : '—';

  return (
    <>
      <div className="grid md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-4">
        <StatCard
          icon={Coins}
          label="Price"
          value={price != null ? `$${price.toFixed(6)}` : offDash}
        />
        <StatCard
          icon={TrendingUp}
          label="Market cap"
          value={marketCap != null ? `$${fmtNum(Math.round(marketCap))}` : offDash}
        />
        <StatCard
          icon={Droplets}
          label="TVL"
          value={enabled && pool.data?.tvlUsd != null ? `$${fmtNum(pool.data.tvlUsd, 0)}` : offDash}
        />
        <StatCard
          icon={Flame}
          label="Burned"
          value={burnedWhole != null ? fmtNum(burnedWhole, 0) : '…'}
          accent="text-danger"
        />
      </div>

      <div className="flex flex-wrap justify-center gap-3 mb-8">
        <Link
          href="/trade"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-primary text-sm font-bold"
        >
          Buy &amp; Sell <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="/pools"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-surface text-sm font-semibold hover:border-primary-400/50 transition-colors"
        >
          Liquidity Pools
        </Link>
        <Link
          href="/whitepaper"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-surface text-sm font-semibold hover:border-primary-400/50 transition-colors"
        >
          Whitepaper
        </Link>
      </div>

      <div className="max-w-4xl mx-auto grid gap-4 lg:grid-cols-2">
        <SupplyCard
          circulating={circulating}
          burned={burnedWhole}
          mint={enabled ? pool.data?.scadMint : undefined}
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-danger" />
              Buy &amp; Burn
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <MiniStat
                label="Total burned"
                value={burnedWhole != null ? fmtNum(burnedWhole, 0) : '…'}
              />
              <MiniStat label="24h burned" value={fmtNum(burned24h, 0)} />
              <MiniStat label="Burn events" value={String(rows.length)} />
            </div>
            <BurnChart points={cumulative} />
            <p className="text-[11px] text-foreground-muted text-center">
              10% of net gaming revenue buys $SCAD from the pool and burns it.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="max-w-4xl mx-auto mt-4 grid gap-4 lg:grid-cols-2">
        <EmissionCard stats={stats.data} burnedWhole={burnedWhole} />
        <DistributionCard alloc={stats.data?.allocation} />
      </div>

      <Card className="max-w-4xl mx-auto mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-danger" />
            Burn history
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-foreground-muted">
              Burns run automatically as the house takes revenue.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-foreground-muted">
                    <th className="text-left font-medium px-6 py-3">Burned</th>
                    <th className="text-right font-medium px-6 py-3">SOL spent</th>
                    <th className="text-right font-medium px-6 py-3">When</th>
                    <th className="text-right font-medium px-6 py-3">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className="border-b border-border/30 last:border-0">
                      <td className="px-6 py-3 font-mono text-danger">
                        -{fmtNum(toWhole(b.scadBurned), 0)} SCAD
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-foreground-muted">
                        {fmtNum(Number(BigInt(b.solSpent)) / 1e9, 4)}
                      </td>
                      <td className="px-6 py-3 text-right text-xs text-foreground-muted">
                        {relTime(b.createdAt)}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {b.burnSignature ? (
                          <a
                            href={solscanTx(b.burnSignature)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary-400 hover:underline font-mono"
                          >
                            {shortSig(b.burnSignature)} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-foreground-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** P2E emission halving progress + current phase/rate + value flows. */
function EmissionCard({ stats, burnedWhole }: { stats?: TokenStats; burnedWhole: number | null }) {
  const emittedWhole = stats ? toWhole(stats.totalEmittedScad) : null;
  const poolWhole = stats ? toWhole(stats.p2ePoolBase) : 500_000_000;
  const toNextWhole = stats ? toWhole(stats.toNextHalvingBase) : null;
  const distributedUsds = stats ? Number(BigInt(stats.totalDistributedUsds)) / 1e6 : null;
  const pct = emittedWhole != null && poolWhole > 0 ? (emittedWhole / poolWhole) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary-400" />
          Play-to-Earn emission
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
              Emitted of 500M pool
            </div>
            <div className="text-2xl font-bold font-mono">
              {emittedWhole != null ? fmtNum(emittedWhole, 0) : '…'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-foreground-muted">Phase</div>
            <div className="font-mono font-semibold">
              {stats ? `${stats.currentPhase} / ${stats.phaseCount}` : '…'}
            </div>
          </div>
        </div>

        <div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-background border border-border/60">
            <div
              className="h-full bg-gradient-primary transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.max(0, pct)).toFixed(2)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-foreground-muted">
            <span>{fmtNum(pct, 1)}% emitted</span>
            <span>{fmtNum(poolWhole, 0)} max</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center">
          <MiniStat
            label="Current rate"
            value={stats ? `${stats.currentRatePerLamport} / SOL` : '…'}
          />
          <MiniStat
            label="To next halving"
            value={toNextWhole != null ? (toNextWhole > 0 ? fmtNum(toNextWhole, 0) : 'ended') : '…'}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-center">
          <MiniStat
            label="Bought & burned"
            value={burnedWhole != null ? fmtNum(burnedWhole, 0) : '…'}
          />
          <MiniStat
            label="USDS distributed"
            value={distributedUsds != null ? `$${fmtNum(distributedUsds, 0)}` : '…'}
          />
        </div>
        <p className="text-[11px] text-foreground-muted text-center">
          {stats
            ? `Earning ${stats.currentRatePerLamport} $SCAD per 1 SOL wagered — the rate halves at each phase cap.`
            : 'Proof-of-wager mints $SCAD on every bet; the rate halves by phase.'}
        </p>
      </CardContent>
    </Card>
  );
}

/** Static 6-way distribution as a stacked bar + legend. */
function DistributionCard({ alloc }: { alloc?: AllocSlice[] }) {
  const slices = alloc ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-primary-400" />
          Distribution
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-3 w-full overflow-hidden rounded-full border border-border/60">
          {slices.length === 0 ? (
            <div className="h-full w-full bg-background" />
          ) : (
            slices.map((s) => (
              <div
                key={s.key}
                className="h-full"
                style={{
                  width: `${(s.fraction * 100).toFixed(2)}%`,
                  backgroundColor: ALLOC_COLORS[s.key] ?? '#64748b',
                }}
                title={`${s.label} — ${fmtNum(s.fraction * 100, 0)}%`}
              />
            ))
          )}
        </div>
        <ul className="space-y-1.5">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: ALLOC_COLORS[s.key] ?? '#64748b' }}
                />
                <span className="text-foreground-muted">{s.label}</span>
              </span>
              <span className="font-mono font-semibold">
                {fmtNum(s.fraction * 100, 0)}% · {fmtNum(s.whole, 0)}
              </span>
            </li>
          ))}
        </ul>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-foreground-muted">
          <Gem className="h-3 w-3" /> Fixed max supply 1,000,000,000 $SCAD
        </p>
      </CardContent>
    </Card>
  );
}

function SupplyCard({
  circulating,
  burned,
  mint,
}: {
  circulating: number | null;
  burned: number | null;
  mint?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary-400" />
          Supply &amp; allocation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
              Total supply
            </div>
            <div className="text-2xl font-bold font-mono">{fmtNum(TOTAL_SUPPLY, 0)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
              Circulating
            </div>
            <div className="font-mono font-semibold">
              {circulating != null ? fmtNum(circulating, 0) : '…'}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
          <span className="text-foreground-muted">Burned (deflationary)</span>
          <span className="font-mono font-semibold text-danger">
            {burned != null ? `-${fmtNum(burned, 0)}` : '…'}
          </span>
        </div>

        <div className="border-t border-border pt-3">
          <div className="text-[10px] uppercase tracking-wider text-foreground-muted mb-1">
            Mint address
          </div>
          {mint ? (
            <a
              href={solscanToken(mint)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-primary-400 hover:underline break-all"
            >
              {mint} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <div className="text-xs text-foreground-muted">
              Deploys with the on-chain pool on devnet launch.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Cumulative-burned area chart (inline SVG, no chart dependency). */
function BurnChart({ points }: { points: number[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-border/50 bg-background text-[11px] text-foreground-muted">
        Cumulative burn appears here as revenue is taken.
      </div>
    );
  }
  const n = points.length;
  const max = points[n - 1] || 1;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => 100 - (v / max) * 96 - 2;
  const line = points.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const area = `0,100 ${line} 100,100`;
  return (
    <div className="relative h-24 w-full overflow-hidden rounded-lg border border-border/50 bg-background">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="burnfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#burnfill)" />
        <polyline
          points={line}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-elevated/40 py-2">
      <div className="text-base font-bold font-mono">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-foreground-muted">{label}</div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-foreground-muted">{label}</span>
          <Icon className="h-4 w-4 text-primary-400" />
        </div>
        <div className={`mt-2 text-2xl font-bold font-mono ${accent ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
