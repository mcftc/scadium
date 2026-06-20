'use client';

import { useState } from 'react';
import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { useMe } from '@/hooks/use-me';
import { useSetRgLimits, useCoolOff, useSelfExclude } from '@/hooks/use-responsible-gambling';
import { formatSol } from '@/lib/format';

const SOL = 1_000_000_000;
const toLamports = (sol: string): string | null =>
  sol && Number(sol) > 0 ? String(Math.floor(Number(sol) * SOL)) : null;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border/40 py-1 last:border-0">
      <span className="text-foreground-muted">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function LimitInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-foreground-muted">
        {label}
      </span>
      <input
        type="number"
        min="0"
        step="0.001"
        placeholder="—"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-border bg-surface-elevated px-3 font-mono text-sm focus:border-primary-400 focus:outline-none"
      />
    </label>
  );
}

export default function ResponsibleGamblingPage() {
  const { data: me } = useMe();
  const rg = me?.responsibleGambling;
  const setLimits = useSetRgLimits();
  const coolOff = useCoolOff();
  const selfExclude = useSelfExclude();
  const [deposit, setDeposit] = useState('');
  const [loss, setLoss] = useState('');
  const [wager, setWager] = useState('');

  // eslint-disable-next-line react-hooks/purity -- reads the wall clock to decide whether a self-exclusion / cool-off window is still in the future; a render-time snapshot of "now" is exactly the intended semantics here (display-only, no money/fairness).
  const now = Date.now();
  const excludedUntil =
    rg?.selfExcludedUntil && new Date(rg.selfExcludedUntil).getTime() > now
      ? new Date(rg.selfExcludedUntil)
      : null;
  const coolingUntil =
    rg?.coolOffUntil && new Date(rg.coolOffUntil).getTime() > now
      ? new Date(rg.coolOffUntil)
      : null;
  const fmtLimit = (v: string | null | undefined) => (v ? `${formatSol(v, 3)} SOL` : '—');

  return (
    <Container>
      <div className="max-w-2xl space-y-6 py-8">
        <h1 className="text-2xl font-bold md:text-3xl">
          <span className="text-gradient">Responsible Gambling</span>
        </h1>
        <p className="text-sm text-foreground-muted">
          Set limits, take a break, or self-exclude. These tools help you stay in control. Limits
          can be lowered any time; cooling-off and self-exclusion cannot be shortened once set.
        </p>

        <Card className="space-y-1 p-6 text-sm">
          <Row
            label="Self-excluded until"
            value={excludedUntil ? excludedUntil.toLocaleString() : '—'}
          />
          <Row
            label="Cooling-off until"
            value={coolingUntil ? coolingUntil.toLocaleString() : '—'}
          />
          <Row label="Daily deposit limit" value={fmtLimit(rg?.dailyDepositLimitLamports)} />
          <Row label="Daily loss limit" value={fmtLimit(rg?.dailyLossLimitLamports)} />
          <Row label="Daily wager limit" value={fmtLimit(rg?.dailyWagerLimitLamports)} />
        </Card>

        <Card className="space-y-3 p-6">
          <h2 className="font-bold">Daily limits (SOL)</h2>
          <div className="grid grid-cols-3 gap-3">
            <LimitInput label="Deposit" value={deposit} onChange={setDeposit} />
            <LimitInput label="Loss" value={loss} onChange={setLoss} />
            <LimitInput label="Wager" value={wager} onChange={setWager} />
          </div>
          <button
            type="button"
            disabled={setLimits.isPending}
            onClick={() =>
              setLimits.mutate({
                dailyDepositLamports: toLamports(deposit),
                dailyLossLamports: toLamports(loss),
                dailyWagerLamports: toLamports(wager),
              })
            }
            className="h-10 rounded-xl bg-emerald-500 px-5 text-sm font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50"
          >
            Save limits
          </button>
          <p className="text-xs text-foreground-muted">Leave a field blank to clear that limit.</p>
        </Card>

        <Card className="space-y-3 p-6">
          <h2 className="font-bold">Take a break (cooling-off)</h2>
          <p className="text-xs text-foreground-muted">
            Blocks wagering for the chosen period. You can still sign in to manage settings. Cannot
            be shortened.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={coolOff.isPending}
              onClick={() => coolOff.mutate(24)}
              className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:border-primary-400/50 disabled:opacity-50"
            >
              24 hours
            </button>
            <button
              type="button"
              disabled={coolOff.isPending}
              onClick={() => coolOff.mutate(168)}
              className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:border-primary-400/50 disabled:opacity-50"
            >
              7 days
            </button>
          </div>
        </Card>

        <Card className="space-y-3 border-danger/40 p-6">
          <h2 className="font-bold text-danger">Self-exclude</h2>
          <p className="text-xs text-foreground-muted">
            Blocks login and play for the chosen period. This cannot be undone or shortened.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={selfExclude.isPending}
              onClick={() => {
                if (window.confirm('Self-exclude for 30 days? This cannot be undone.'))
                  selfExclude.mutate(30);
              }}
              className="rounded-xl border border-danger/50 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              30 days
            </button>
            <button
              type="button"
              disabled={selfExclude.isPending}
              onClick={() => {
                if (window.confirm('Self-exclude for 1 year? This cannot be undone.'))
                  selfExclude.mutate(365);
              }}
              className="rounded-xl border border-danger/50 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              1 year
            </button>
          </div>
        </Card>
      </div>
    </Container>
  );
}
