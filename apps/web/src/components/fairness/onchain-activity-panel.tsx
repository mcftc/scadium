'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Link2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';

interface AddrStatus {
  enabled?: boolean;
  programId?: string | null;
  address?: string | null;
  explorerUrl: string | null;
}

interface OnchainStatus {
  cluster: string;
  live: boolean;
  rng: AddrStatus;
  lottery: AddrStatus;
  vault: AddrStatus;
  scadMint: AddrStatus;
  usdsMint: AddrStatus;
}

const short = (id: string | null | undefined) => (id ? `${id.slice(0, 4)}…${id.slice(-4)}` : null);

/**
 * Surfaces the "background blockchain activity" — the shared `scadium_rng`
 * program every game draws its provably-fair entropy from, plus the lottery /
 * vault programs and the $SCAD / USDS token mints — each linking straight to
 * Solscan on the configured cluster. A LIVE badge says whether outcomes are
 * actually anchored on-chain right now, or running in the off-chain-first
 * play-money mode (the synthetic-slot-hash fallback). Reads `/fairness/onchain`.
 */
export function OnchainActivityPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['onchain-status'],
    queryFn: () => api<OnchainStatus>('/fairness/onchain'),
    staleTime: 30_000,
    retry: false,
  });

  if (isLoading || isError || !data) return null;

  const rows: { label: string; sub: string; id: string | null; url: string | null }[] = [
    {
      label: 'Shared RNG',
      sub: 'scadium_rng — anchors every game',
      id: data.rng.programId ?? null,
      url: data.rng.explorerUrl,
    },
    {
      label: '$SCAD token',
      sub: 'SPL mint (1B, 9 decimals)',
      id: data.scadMint.address ?? null,
      url: data.scadMint.explorerUrl,
    },
    {
      label: 'Lottery',
      sub: 'scadium_lottery program',
      id: data.lottery.programId ?? null,
      url: data.lottery.explorerUrl,
    },
    {
      label: 'Vault',
      sub: 'scadium_vault program',
      id: data.vault.programId ?? null,
      url: data.vault.explorerUrl,
    },
  ];

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>On-chain activity</CardTitle>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold',
              data.live
                ? 'bg-success/15 text-success'
                : 'bg-surface-elevated text-foreground-muted border border-border',
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {data.live ? `Live on ${data.cluster}` : 'Play-money (off-chain)'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-foreground-muted leading-relaxed">
          {data.live ? (
            <>
              Every game&apos;s outcome — multiplier, win/lose, number — is derived from ONE
              program&apos;s commit→reveal + Solana SlotHashes entropy. Follow the round activity on
              Solscan.
            </>
          ) : (
            <>
              The chain layer is in off-chain-first play-money mode: outcomes derive from a
              deterministic synthetic slot hash (still provably fair, reproducible in the verifier).
              Once <code>scadium_rng</code> is deployed to <strong>{data.cluster}</strong>, every
              game anchors on it and the links below go live.
            </>
          )}
        </p>
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface-elevated">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{r.label}</div>
                <div className="text-[11px] text-foreground-muted">{r.sub}</div>
              </div>
              {r.url && r.id ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-xs text-primary-400 hover:underline"
                >
                  {short(r.id)}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
                  <Link2 className="h-3.5 w-3.5 shrink-0" />
                  not deployed
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
