'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Package, Percent, Coins } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/cn';
import { DailyCaseModal } from './daily-case-modal';

interface RewardsSummary {
  wagerClaimableScad: string;
  cashbackClaimableScad: string;
  dailyCase: { available: boolean; nextAvailableAt: string | null };
  chainEnabled: boolean;
}

function formatScad(base: string): string {
  const n = Number(BigInt(base)) / 1e9;
  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2);
}

/**
 * Header rewards dropdown (solpump-style): Daily Case, Cashback and wager
 * $SCAD — each claimable on-chain from the rewards treasury.
 */
export function RewardsDropdown() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const summary = useQuery({
    queryKey: ['rewards', 'summary'],
    enabled: !!token,
    queryFn: () => api<RewardsSummary>('/rewards/summary', { token }),
    refetchInterval: 30_000,
  });

  const claim = useMutation({
    mutationFn: (kind: 'wagerReward' | 'cashback') =>
      api('/rewards/claim', { method: 'POST', body: { kind }, token }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rewards'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!token || !summary.data) return null;
  const s = summary.data;
  const totalClaimable =
    BigInt(s.wagerClaimableScad) + BigInt(s.cashbackClaimableScad);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border whitespace-nowrap transition-colors',
          totalClaimable > BigInt(0) || s.dailyCase.available
            ? 'border-primary-400/50 bg-primary-400/10 text-primary-300'
            : 'border-border bg-surface text-foreground-muted',
        )}
      >
        <Gift className="h-3.5 w-3.5" />
        <span className="hidden sm:inline text-[10px] font-bold">Rewards</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-surface shadow-2xl shadow-primary-900/30 overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-border text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Claim your rewards
          </div>

          <RewardRow
            icon={Package}
            title="Daily Case"
            subtitle={
              s.dailyCase.available ? 'Ready to open' : 'Opens again tomorrow'
            }
            action={s.dailyCase.available ? 'Open' : null}
            busy={false}
            onAction={() => {
              setOpen(false);
              setCaseOpen(true);
            }}
          />
          <RewardRow
            icon={Percent}
            title="Cashback"
            subtitle={`${formatScad(s.cashbackClaimableScad)} SCAD`}
            action={BigInt(s.cashbackClaimableScad) > BigInt(0) ? 'Claim' : null}
            busy={claim.isPending}
            onAction={() => claim.mutate('cashback')}
          />
          <RewardRow
            icon={Coins}
            title="$SCAD Rewards"
            subtitle={`${formatScad(s.wagerClaimableScad)} SCAD`}
            action={BigInt(s.wagerClaimableScad) > BigInt(0) ? 'Claim' : null}
            busy={claim.isPending}
            onAction={() => claim.mutate('wagerReward')}
          />
        </div>
      )}

      <DailyCaseModal open={caseOpen} onClose={() => setCaseOpen(false)} />
    </div>
  );
}

function RewardRow({
  icon: Icon,
  title,
  subtitle,
  action,
  busy,
  onAction,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  action: string | null;
  busy: boolean;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-0">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-400/10 border border-primary-400/20">
        <Icon className="h-4 w-4 text-primary-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-foreground-muted truncate">{subtitle}</div>
      </div>
      {action && (
        <button
          type="button"
          disabled={busy}
          onClick={onAction}
          className="px-3 py-1.5 rounded-lg bg-gradient-primary text-xs font-bold disabled:opacity-50"
        >
          {busy ? '…' : action}
        </button>
      )}
    </div>
  );
}
