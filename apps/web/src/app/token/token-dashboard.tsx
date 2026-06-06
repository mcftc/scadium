'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Flame, Coins, TrendingUp, Droplets, ExternalLink, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';

const TOTAL_SUPPLY = 217_755_972;

interface PoolInfo {
  enabled: boolean;
  scadMint: string;
  priceUsd: number;
  tvlUsd: number;
}
interface BurnsResponse {
  totalBurned: string;
  burns: {
    id: string;
    scadBurned: string;
    solSpent: string;
    burnSignature: string | null;
    createdAt: string;
  }[];
}

const fmtScad = (base: string | bigint) =>
  (Number(BigInt(base)) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Live stats + burn feed for the $SCAD token page — data straight from the
 * pool (price/TVL) and the buy-and-burn ledger. */
export function TokenDashboard() {
  const pool = useQuery({
    queryKey: ['swap', 'pool'],
    queryFn: () => api<PoolInfo>('/swap/pool'),
    refetchInterval: 15_000,
  });
  const burns = useQuery({
    queryKey: ['swap', 'burns'],
    queryFn: () => api<BurnsResponse>('/swap/burns'),
    refetchInterval: 60_000,
  });

  const price = pool.data?.enabled ? pool.data.priceUsd : null;
  const burned = burns.data ? Number(BigInt(burns.data.totalBurned)) / 1e9 : null;
  const circulating = burned != null ? TOTAL_SUPPLY - burned : null;
  const marketCap = price != null && circulating != null ? price * circulating : null;

  return (
    <>
      <div className="grid md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-4">
        <StatCard
          icon={Coins}
          label="Price"
          value={price != null ? `$${price.toFixed(6)}` : '…'}
        />
        <StatCard
          icon={TrendingUp}
          label="Market cap"
          value={marketCap != null ? `$${Math.round(marketCap).toLocaleString()}` : '…'}
        />
        <StatCard
          icon={Droplets}
          label="TVL"
          value={pool.data?.enabled ? `$${pool.data.tvlUsd.toFixed(0)}` : '…'}
        />
        <StatCard
          icon={Flame}
          label="Burned"
          value={burned != null ? burned.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '…'}
        />
      </div>

      <div className="flex justify-center gap-3 mb-8">
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

      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary-400" />
            Token burns — 20% of net gaming revenue
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(burns.data?.burns ?? []).length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-foreground-muted">
              Burns run automatically as the house takes revenue.
            </div>
          ) : (
            <div>
              {burns.data!.burns.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between px-6 py-3 border-b border-border/30 last:border-0 text-sm"
                >
                  <span className="font-mono text-danger">-{fmtScad(b.scadBurned)} SCAD</span>
                  <span className="text-xs text-foreground-muted">
                    {new Date(b.createdAt).toLocaleString()}
                  </span>
                  {b.burnSignature ? (
                    <a
                      href={`https://solscan.io/tx/${b.burnSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary-400 hover:underline font-mono"
                    >
                      {b.burnSignature.slice(0, 8)}… <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-xs text-foreground-muted">—</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-foreground-muted">{label}</span>
          <Icon className="h-4 w-4 text-primary-400" />
        </div>
        <div className="mt-2 text-2xl font-bold font-mono">{value}</div>
      </CardContent>
    </Card>
  );
}
