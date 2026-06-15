'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { ata, buildAddLiquidityTx, buildRemoveLiquidityTx, swapPdas } from '@/lib/swap';
import { solscanTx } from '@/lib/explorer';

interface PoolInfo {
  enabled: boolean;
  programId: string;
  scadMint: string;
  scadReserve: string;
  solReserve: string;
  lpSupply: string;
  feeBps: number;
  priceUsd: number;
  tvlUsd: number;
}

const fmt = (base: string | bigint, dp = 2) =>
  (Number(BigInt(base)) / 1e9).toLocaleString(undefined, { maximumFractionDigits: dp });

/**
 * SCAD/SOL liquidity page — add a pair position, earn the swap fee,
 * remove pro-rata. LP balance is read straight from the wallet's LP ATA.
 */
export function PoolsPanel() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const qc = useQueryClient();
  const [scadAmt, setScadAmt] = useState('1000');
  const [solAmt, setSolAmt] = useState('0.2');
  const [removePct, setRemovePct] = useState('50');
  const [busy, setBusy] = useState<null | 'add' | 'remove'>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pool = useQuery({
    queryKey: ['swap', 'pool'],
    queryFn: () => api<PoolInfo>('/swap/pool'),
    refetchInterval: 15_000,
  });

  const lpBalance = useQuery({
    queryKey: ['swap', 'lp', publicKey?.toBase58()],
    enabled: !!publicKey && !!pool.data?.enabled,
    queryFn: async () => {
      const { lpMint } = swapPdas(new PublicKey(pool.data!.programId));
      const acct = await connection
        .getTokenAccountBalance(ata(lpMint, publicKey!))
        .catch(() => null);
      return acct?.value.amount ?? '0';
    },
    refetchInterval: 15_000,
  });

  async function run(kind: 'add' | 'remove') {
    const p = pool.data;
    if (!p?.enabled || !publicKey) return;
    setError(null);
    setLastSig(null);
    setBusy(kind);
    try {
      const programId = new PublicKey(p.programId);
      const scadMint = new PublicKey(p.scadMint);
      let tx;
      if (kind === 'add') {
        const scad = BigInt(Math.round(Number(scadAmt) * 1e9));
        const sol = BigInt(Math.round(Number(solAmt) * 1e9));
        if (scad <= 0n || sol <= 0n) throw new Error('Enter both amounts');
        tx = buildAddLiquidityTx(programId, scadMint, publicKey, scad, sol, 0n);
      } else {
        const pct = Math.min(Math.max(Number(removePct) || 0, 1), 100);
        const lp = (BigInt(lpBalance.data ?? '0') * BigInt(pct)) / 100n;
        if (lp <= 0n) throw new Error('No LP to remove');
        tx = buildRemoveLiquidityTx(programId, scadMint, publicKey, lp, 0n, 0n);
      }
      const latest = await connection.getLatestBlockhash();
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
      setLastSig(sig);
      void qc.invalidateQueries({ queryKey: ['swap'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Mirror /trade and /wallet: when the pool isn't configured (play-money mode),
  // show a clear notice instead of live-looking inputs whose buttons silently no-op.
  if (pool.data && !pool.data.enabled) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-foreground-muted">
          Liquidity pool is not configured on this server yet.
        </CardContent>
      </Card>
    );
  }

  const p = pool.data;
  const sharePct =
    p && lpBalance.data && BigInt(p.lpSupply) > 0n
      ? (Number(BigInt(lpBalance.data)) / Number(BigInt(p.lpSupply))) * 100
      : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your position</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <Box label="LP tokens" value={lpBalance.data ? fmt(lpBalance.data, 4) : '…'} />
            <Box label="Pool share" value={`${sharePct.toFixed(2)}%`} />
            <Box label="Pool TVL" value={p ? `$${p.tvlUsd.toFixed(0)}` : '…'} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add liquidity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-foreground-muted">
            Deposit both sides at the current ratio and earn the {p ? p.feeBps / 100 : 1}% swap fee.
            Be aware of impermanent loss.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label="$SCAD" value={scadAmt} onChange={setScadAmt} />
            <LabeledInput label="SOL" value={solAmt} onChange={setSolAmt} />
          </div>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy !== null || !publicKey}
            onClick={() => void run('add')}
          >
            {busy === 'add' ? 'Adding…' : 'Add Position'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Remove liquidity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LabeledInput label="Percent of position" value={removePct} onChange={setRemovePct} />
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={busy !== null || !publicKey}
            onClick={() => void run('remove')}
          >
            {busy === 'remove' ? 'Removing…' : 'Remove'}
          </Button>
          {error && <p className="text-xs text-danger break-all">{error}</p>}
          {lastSig && (
            <a
              href={solscanTx(lastSig)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary-400 hover:underline break-all"
            >
              View transaction on Solscan <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <div className="text-xs uppercase tracking-wider text-foreground-muted">{label}</div>
      <div className="mt-1 text-lg font-bold font-mono">{value}</div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wider text-foreground-muted">{label}</label>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-surface-elevated px-4 py-3 font-mono text-sm focus:border-primary-400/60 focus:outline-none"
      />
    </div>
  );
}
