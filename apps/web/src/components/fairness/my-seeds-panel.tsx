'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/auth-store';

interface SeedView {
  serverSeedHash: string;
  nextServerSeedHash: string;
  clientSeed: string;
  nonce: string;
}
interface RotateResult {
  revealedServerSeed: string;
  serverSeedHash: string;
  nextServerSeedHash: string;
}

/**
 * Per-user provably-fair seed control (Phase I #18/#94). View the active +
 * pre-committed server-seed hashes and nonce, set your own client seed, and
 * rotate the server seed to reveal it (so you can check it matches the
 * previously-published commitment). Backed by /fairness/seed* (#91).
 */
export function MySeedsPanel() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);

  const seed = useQuery({
    queryKey: ['fairness', 'seed'],
    enabled: !!token,
    queryFn: () => api<SeedView>('/fairness/seed', { token }),
  });

  // Sync the editable field whenever the active client seed changes (load / set / rotate).
  useEffect(() => {
    if (seed.data) setDraft(seed.data.clientSeed);
  }, [seed.data?.clientSeed]);

  const setClient = useMutation({
    mutationFn: (clientSeed: string) =>
      api<SeedView>('/fairness/seed/client', { method: 'POST', body: { clientSeed }, token }),
    onSuccess: (data) => qc.setQueryData(['fairness', 'seed'], data),
  });

  const rotate = useMutation({
    mutationFn: () => api<RotateResult>('/fairness/seed/rotate', { method: 'POST', token }),
    onSuccess: (data) => {
      setRevealed(data.revealedServerSeed);
      void qc.invalidateQueries({ queryKey: ['fairness', 'seed'] });
    },
  });

  if (!token) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>My seeds</CardTitle>
        </CardHeader>
        <CardContent className="text-foreground-muted">
          Connect your wallet to view and control your provably-fair seeds.
        </CardContent>
      </Card>
    );
  }

  const s = seed.data;
  const draftValid = draft.trim().length >= 1 && draft.trim().length <= 64;
  const err = (setClient.error ?? rotate.error) as Error | null;

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>My seeds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <Field label="Active server seed (sha256 commitment)" value={s?.serverSeedHash} mono />
        <Field label="Next server seed — pre-committed" value={s?.nextServerSeedHash} mono />
        <Field label="Current nonce" value={s?.nonce} />

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-foreground-muted">
            Your client seed
          </label>
          <div className="flex gap-2">
            <input
              value={draft}
              maxLength={64}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 rounded-xl border border-border bg-surface-elevated px-4 py-2.5 font-mono text-sm focus:border-primary-400/60 focus:outline-none"
            />
            <Button
              variant="primary"
              disabled={setClient.isPending || !draftValid || draft === s?.clientSeed}
              onClick={() => setClient.mutate(draft.trim())}
            >
              {setClient.isPending ? 'Saving…' : 'Set'}
            </Button>
          </div>
          <p className="text-xs text-foreground-muted">
            1–64 characters. Setting a new client seed resets your nonce to 0.
          </p>
        </div>

        <div className="space-y-2">
          <Button variant="secondary" disabled={rotate.isPending} onClick={() => rotate.mutate()}>
            <RotateCw className="h-4 w-4" /> {rotate.isPending ? 'Rotating…' : 'Rotate server seed'}
          </Button>
          <p className="text-xs text-foreground-muted">
            Reveals your current server seed (check <code>sha256(seed)</code> equals the commitment
            above) and pre-commits a fresh one.
          </p>
          {revealed && <Field label="Revealed previous server seed" value={revealed} mono />}
        </div>

        {err && <p className="text-xs text-danger break-all">{err.message}</p>}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wider text-foreground-muted">{label}</div>
      <div
        className={cn(
          'rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm break-all',
          mono && 'font-mono',
        )}
      >
        {value ?? '…'}
      </div>
    </div>
  );
}
