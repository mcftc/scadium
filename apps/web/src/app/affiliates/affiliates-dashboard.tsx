'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Users, Coins, Gift } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { formatSol, shortAddress, formatDate } from '@/lib/format';
import { AFFILIATE, GAME_HOUSE_EDGE } from '@scadium/shared';

/** Display names for AFFILIATE's tiers (the thresholds and rates live in shared). */
const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Diamond'] as const;

interface Stats {
  refCode: string;
  referralCount: number;
  totalVolumeLamports: string;
  totalCommissionLamports: string;
  referralUrl: string;
}

interface Referral {
  id: string;
  createdAt: string;
  volumeLamports: string;
  commissionLamports: string;
  referee: {
    id: string;
    username: string | null;
    walletAddress: string;
    joinedAt: string;
  };
}

export function AffiliatesDashboard() {
  const token = useAuthStore((s) => s.accessToken);
  const [copied, setCopied] = useState(false);

  const stats = useQuery({
    queryKey: ['affiliates', 'stats'],
    queryFn: () => api<Stats>('/affiliates/stats', { token }),
    enabled: !!token,
  });
  const recent = useQuery({
    queryKey: ['affiliates', 'recent'],
    queryFn: () => api<Referral[]>('/affiliates/recent', { token }),
    enabled: !!token,
  });

  async function copy() {
    if (!stats.data) return;
    await navigator.clipboard.writeText(stats.data.referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!stats.data) {
    return <div className="py-16 text-center text-foreground-muted">Loading…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card id="referral-link" className="scroll-mt-28">
        <CardHeader>
          <CardTitle>Your referral link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm bg-surface-elevated px-4 py-3 rounded-xl border border-border overflow-x-auto">
              {stats.data.referralUrl}
            </code>
            <Button variant="secondary" size="icon" onClick={copy} aria-label="Copy">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {copied && <p className="text-xs text-success">Copied to clipboard</p>}
          <div className="text-xs text-foreground-muted">
            Code: <span className="font-mono text-primary-400">{stats.data.refCode}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Users} label="Referrals" value={stats.data.referralCount.toString()} />
        <StatCard
          icon={Coins}
          label="Volume"
          value={formatSol(stats.data.totalVolumeLamports, 3)}
        />
        <StatCard
          icon={Gift}
          label="Commission earned"
          value={formatSol(stats.data.totalCommissionLamports, 4)}
          accent
        />
      </div>

      <Card id="recent-referrals" className="scroll-mt-28">
        <CardHeader>
          <CardTitle>Recent referrals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!recent.data || recent.data.length === 0 ? (
            <div className="py-16 text-center text-foreground-muted text-sm">
              No referrals yet. Share your link to get started.
            </div>
          ) : (
            <div>
              {recent.data.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-6 py-4 border-b border-border/30 last:border-0"
                >
                  <div>
                    <div className="font-semibold text-sm">
                      {r.referee.username ?? shortAddress(r.referee.walletAddress)}
                    </div>
                    <div className="text-xs text-foreground-muted">
                      joined {formatDate(r.referee.joinedAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm">{formatSol(r.commissionLamports, 4)}</div>
                    <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
                      earned
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card id="commission-tiers" className="scroll-mt-28">
        <CardHeader>
          <CardTitle>Commission tiers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-foreground-muted">
            You earn this share of the <span className="text-foreground">house edge</span> on every
            wager your referrals make — e.g. {Math.round((AFFILIATE.TIER_COMMISSION[0] ?? 0) * 100)}
            % of a coinflip&apos;s {Math.round(GAME_HOUSE_EDGE.coinflip * 100)}% edge is{' '}
            {((AFFILIATE.TIER_COMMISSION[0] ?? 0) * GAME_HOUSE_EDGE.coinflip * 100).toFixed(2)}% of
            the stake. The lottery has no house edge, so it earns volume but no commission.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {TIER_NAMES.map((tier, i) => ({
              tier,
              volume:
                i === 0 ? '0+' : `${Number(AFFILIATE.TIER_THRESHOLDS_LAMPORTS[i] ?? 0) / 1e9} SOL`,
              rate: `${Math.round((AFFILIATE.TIER_COMMISSION[i] ?? 0) * 100)}%`,
            })).map((t) => (
              <div key={t.tier} className="rounded-xl border border-border bg-surface-elevated p-4">
                <div className="text-xs uppercase tracking-wider text-foreground-muted">
                  {t.tier}
                </div>
                <div className="text-2xl font-bold text-gradient mt-1">{t.rate}</div>
                <div className="text-xs text-foreground-muted">{t.volume} vol</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
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
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-foreground-muted">{label}</span>
          <Icon className="h-4 w-4 text-primary-400" />
        </div>
        <div className={`mt-2 text-2xl font-bold ${accent ? 'text-gradient' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
