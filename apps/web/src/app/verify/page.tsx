'use client';

import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { useMe } from '@/hooks/use-me';
import { useStartKyc } from '@/hooks/use-kyc';

const COPY: Record<string, string> = {
  none: 'Verify your identity to deposit or withdraw real funds.',
  pending: 'Your verification is in progress — this usually takes a few minutes.',
  approved: 'Your identity is verified. Deposits and withdrawals are unlocked.',
  rejected: 'Verification was not successful. Please contact support.',
};

export default function VerifyPage() {
  const { data: me } = useMe();
  const start = useStartKyc();
  const status = me?.kycStatus ?? 'none';

  return (
    <Container>
      <div className="mx-auto max-w-xl space-y-4 py-8">
        <h1 className="text-2xl font-bold md:text-3xl">
          <span className="text-gradient">Identity Verification</span>
        </h1>
        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-foreground-muted">Status</span>
            <span className="rounded-full bg-surface-elevated px-2 py-0.5 font-mono text-xs font-bold uppercase">
              {status}
            </span>
          </div>
          <p className="text-sm text-foreground-muted">{COPY[status] ?? COPY.none}</p>
          {status !== 'approved' && status !== 'pending' && (
            <button
              type="button"
              disabled={start.isPending}
              onClick={() => start.mutate()}
              className="rounded-xl bg-gradient-primary px-6 py-3 text-sm font-bold text-white shadow-glow-sm disabled:opacity-50"
            >
              Start verification
            </button>
          )}
          <p className="text-xs text-foreground-muted">
            We never store your documents — only your verification status from the provider.
          </p>
        </Card>
      </div>
    </Container>
  );
}
