'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Coins,
  TrendingUp,
  Droplets,
  ExternalLink,
  ArrowRight,
  Gem,
  PieChart,
  Sparkles,
} from 'lucide-react';
import { SCAD, MINING, blockRewardAt, emissionEraAt, msToNextHalving } from '@scadium/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { solscanToken } from '@/lib/explorer';

const TOTAL_SUPPLY = SCAD.TOTAL_SUPPLY;

interface PoolInfo {
  enabled: boolean;
  scadMint?: string;
  priceUsd?: number;
  tvlUsd?: number;
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

/** Live stats + tokenomics for the $SCAD token page. */
export function TokenDashboard() {
  const pool = useQuery({
    queryKey: ['swap', 'pool'],
    queryFn: () => api<PoolInfo>('/swap/pool'),
    refetchInterval: 15_000,
  });
  const stats = useQuery({
    queryKey: ['token', 'stats'],
    queryFn: () => api<TokenStats>('/token/stats'),
    refetchInterval: 30_000, // matches the engine dashboard poll
  });

  const enabled = pool.data?.enabled ?? false;
  const price = enabled ? (pool.data?.priceUsd ?? null) : null;
  const circulating = TOTAL_SUPPLY;
  const marketCap = price != null ? price * circulating : null;

  const offDash = pool.isLoading ? '…' : '—';

  return (
    <>
      <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto mb-4">
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

      <div className="max-w-4xl mx-auto">
        <SupplyCard circulating={circulating} mint={enabled ? pool.data?.scadMint : undefined} />
      </div>

      <div className="max-w-4xl mx-auto mt-4 grid gap-4 lg:grid-cols-2">
        <EmissionCard stats={stats.data} />
        <DistributionCard alloc={stats.data?.allocation} />
      </div>
    </>
  );
}

/** P2E emission halving progress + current phase/rate + value flows. */
function EmissionCard({ stats }: { stats?: TokenStats }) {
  const emittedWhole = stats ? toWhole(stats.totalEmittedScad) : null;
  const poolWhole = stats ? toWhole(stats.p2ePoolBase) : 500_000_000;
  // SCAD Engine: emission is the HOURLY block reward, halving every 4 years
  // (time-based, Bitcoin-style). Derived from the engine constants so it matches
  // BlockMiningService. Render-time wall-clock reads are display-only (no money).
  // eslint-disable-next-line react-hooks/purity -- 4-year-halving era/reward/countdown at call time; display-only.
  const now = Date.now();
  const era = emissionEraAt(now);
  const yrToHalving = msToNextHalving(now) / 31_536_000_000;
  const blockRewardWhole = stats
    ? toWhole(blockRewardAt(now, BigInt(stats.totalEmittedScad)).toString())
    : null;
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
            <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
              Halving era
            </div>
            <div className="font-mono font-semibold">
              {stats ? `Era ${era + 1} · ${MINING.YEARS_PER_HALVING}yr` : '…'}
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
            label="Block reward"
            value={blockRewardWhole != null ? `${fmtNum(blockRewardWhole, 0)} / hr` : '…'}
          />
          <MiniStat label="Next halving" value={stats ? `~${yrToHalving.toFixed(1)} yr` : '…'} />
        </div>

        <div className="grid grid-cols-1 gap-2 border-t border-border pt-3 text-center">
          <MiniStat
            label="USDS distributed"
            value={distributedUsds != null ? `$${fmtNum(distributedUsds, 0)}` : '…'}
          />
        </div>
        <p className="text-[11px] text-foreground-muted text-center">
          {blockRewardWhole != null
            ? `Proof-of-Play: each hour mints a ${fmtNum(blockRewardWhole, 0)} $SCAD block (halving every 4 years), split across players by play-rate.`
            : 'Proof-of-Play: an hourly $SCAD block, split by play-rate, halving every 4 years.'}
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

function SupplyCard({ circulating, mint }: { circulating: number | null; mint?: string }) {
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
