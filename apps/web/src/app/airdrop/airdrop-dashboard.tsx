'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Check, X, Loader2, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { formatSol } from '@/lib/format';
import { useAuthStore } from '@/store/auth-store';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';

interface NextDrop {
  nextDropAt: string;
  intervalMs: number;
  poolLamports: string;
}
interface Eligibility {
  wageredLamports: string;
  chatMessages: number;
  eligible: boolean;
}
interface CaseStatus {
  available: boolean;
  nextAvailableAt: string | null;
}
interface CaseOpenResult {
  tier: string;
  rewardLamports: string;
  nextAvailableAt: string;
}

export function AirdropDashboard() {
  const token = useAuthStore((s) => s.accessToken);
  const { isAuthenticated } = useWalletAuth();
  const { open } = useWalletModal();
  const qc = useQueryClient();
  const [lastOpen, setLastOpen] = useState<CaseOpenResult | null>(null);

  const next = useQuery({
    queryKey: ['airdrop', 'next'],
    queryFn: () => api<NextDrop>('/airdrop/next'),
    refetchInterval: 60_000,
  });
  const eligibility = useQuery({
    queryKey: ['airdrop', 'eligibility'],
    enabled: !!token,
    queryFn: () => api<Eligibility>('/airdrop/eligibility', { token }),
  });
  const caseStatus = useQuery({
    queryKey: ['airdrop', 'case'],
    enabled: !!token,
    queryFn: () => api<CaseStatus>('/airdrop/case/status', { token }),
  });
  const openCase = useMutation({
    mutationFn: () =>
      api<CaseOpenResult>('/airdrop/case/open', { method: 'POST', token }),
    onSuccess: (res) => {
      setLastOpen(res);
      qc.invalidateQueries({ queryKey: ['airdrop', 'case'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const [countdown, setCountdown] = useState('');
  useEffect(() => {
    if (!next.data) return;
    const update = () => {
      const ms = Math.max(0, new Date(next.data.nextDropAt).getTime() - Date.now());
      const mins = Math.floor(ms / 60_000);
      const secs = Math.floor((ms % 60_000) / 1000);
      setCountdown(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [next.data]);

  const openCaseError =
    openCase.error instanceof ApiError ? openCase.error.message : null;

  return (
    <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Next hourly drop</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
              Pool
            </div>
            <div className="text-3xl font-bold text-gradient">
              {next.data ? formatSol(next.data.poolLamports, 2) : '…'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
              Drops in
            </div>
            <div className="text-4xl font-mono font-bold flex items-center justify-center gap-2">
              <Clock className="h-6 w-6 text-primary-400" />
              {countdown || '—'}
            </div>
          </div>
          {!isAuthenticated ? (
            <Button onClick={open} className="w-full">
              Connect to check eligibility
            </Button>
          ) : (
            <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-3">
              <div className="text-xs uppercase tracking-wider text-foreground-muted">
                Eligibility
              </div>
              <EligibilityRow
                label="Wagered ≥ 0.001 SOL this hour"
                ok={
                  !!eligibility.data && BigInt(eligibility.data.wageredLamports) >= BigInt(1_000_000)
                }
                value={eligibility.data ? formatSol(eligibility.data.wageredLamports, 4) : '—'}
              />
              <EligibilityRow
                label="Chat activity this hour"
                ok={!!eligibility.data && eligibility.data.chatMessages > 0}
                value={`${eligibility.data?.chatMessages ?? 0} msgs`}
              />
              {eligibility.data?.eligible ? (
                <div className="text-xs text-success text-center pt-2 border-t border-border">
                  You qualify for the next drop
                </div>
              ) : (
                <div className="text-xs text-foreground-muted text-center pt-2 border-t border-border">
                  Wager in any game and send a chat message to qualify
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily case</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <div className="mx-auto h-32 w-32 rounded-3xl bg-gradient-primary shadow-glow flex items-center justify-center">
            <Gift className="h-16 w-16 text-white" />
          </div>
          {lastOpen && (
            <div className="rounded-xl border border-primary-400/30 bg-primary-400/10 p-4">
              <div className="text-xs uppercase tracking-wider text-foreground-muted">
                You won
              </div>
              <div className="text-2xl font-bold text-gradient mt-1">
                {formatSol(lastOpen.rewardLamports, 4)}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-primary-400 mt-1">
                {lastOpen.tier}
              </div>
            </div>
          )}
          {!isAuthenticated ? (
            <Button onClick={open} className="w-full">
              Connect to open
            </Button>
          ) : caseStatus.data?.available ? (
            <Button
              size="lg"
              className="w-full"
              onClick={() => openCase.mutate()}
              disabled={openCase.isPending}
            >
              {openCase.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Gift className="h-5 w-5" />
              )}
              Open free case
            </Button>
          ) : (
            <Button size="lg" className="w-full" disabled>
              <Clock className="h-5 w-5" />
              Next case tomorrow
            </Button>
          )}
          {openCaseError && (
            <p className="text-xs text-danger">{openCaseError}</p>
          )}
          <div className="text-[11px] text-foreground-muted">
            Drops: 89% common · 10% rare · 1% epic · 0.1% legendary (1 SOL)
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EligibilityRow({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2">
        {ok ? (
          <Check className="h-4 w-4 text-success" />
        ) : (
          <X className="h-4 w-4 text-danger" />
        )}
        {label}
      </span>
      <span className="font-mono text-xs text-foreground-muted">{value}</span>
    </div>
  );
}
