'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { ExternalLink, Flame } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { buildSwapTx, quoteSwap } from '@/lib/swap';
import { cn } from '@/lib/cn';
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
interface TradeRow {
  signature: string;
  user: string;
  side: 'buy' | 'sell';
  scadAmount: string;
  solAmount: string;
  priceUsd: number;
  blockTime: number | null;
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
const fmtSol = (base: string | bigint) => (Number(BigInt(base)) / 1e9).toFixed(4);
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

/** Buy & Sell screen — chart-lite, swap form, on-chain trades + burns. */
export function TradePanel() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const qc = useQueryClient();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('0.1');
  const [slippage, setSlippage] = useState('2.5');
  const [tab, setTab] = useState<'trades' | 'burns'>('trades');
  const [busy, setBusy] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pool = useQuery({
    queryKey: ['swap', 'pool'],
    queryFn: () => api<PoolInfo>('/swap/pool'),
    refetchInterval: 10_000,
  });
  const trades = useQuery({
    queryKey: ['swap', 'trades'],
    queryFn: () => api<TradeRow[]>('/swap/trades'),
    refetchInterval: 12_000,
  });
  const burns = useQuery({
    queryKey: ['swap', 'burns'],
    queryFn: () => api<BurnsResponse>('/swap/burns'),
    refetchInterval: 60_000,
  });

  // Quote: input is SOL when buying, SCAD when selling.
  const quote = useMemo(() => {
    const p = pool.data;
    const amt = Number(amount);
    if (!p?.enabled || !Number.isFinite(amt) || amt <= 0) return null;
    const amountIn = BigInt(Math.round(amt * 1e9));
    const scadRes = BigInt(p.scadReserve);
    const solRes = BigInt(p.solReserve);
    const [rIn, rOut] = side === 'buy' ? [solRes, scadRes] : [scadRes, solRes];
    return { amountIn, ...quoteSwap(amountIn, rIn, rOut, p.feeBps) };
  }, [pool.data, amount, side]);

  async function executeSwap() {
    const p = pool.data;
    if (!p?.enabled || !publicKey || !quote) return;
    setError(null);
    setLastSig(null);
    setBusy(true);
    try {
      const slipPct = Math.min(Math.max(Number(slippage) || 0, 0), 50);
      const minOut = (quote.amountOut * BigInt(Math.round((100 - slipPct) * 100))) / 10_000n;
      const tx = buildSwapTx(
        new PublicKey(p.programId),
        new PublicKey(p.scadMint),
        publicKey,
        side === 'buy',
        quote.amountIn,
        minOut,
      );
      const latest = await connection.getLatestBlockhash();
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
      setLastSig(sig);
      void qc.invalidateQueries({ queryKey: ['swap'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (pool.data && !pool.data.enabled) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-foreground-muted">
          Swap pool is not configured on this server yet.
        </CardContent>
      </Card>
    );
  }
  const p = pool.data;

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      {/* Left: market overview + history */}
      <div className="lg:col-span-3 space-y-6">
        <Card>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <div>
                <div className="text-xs uppercase tracking-wider text-foreground-muted">
                  $SCAD price
                </div>
                <div className="text-2xl font-bold text-gradient font-mono">
                  ${p ? p.priceUsd.toFixed(6) : '…'}
                </div>
              </div>
              <Stat label="TVL" value={p ? `$${p.tvlUsd.toFixed(0)}` : '…'} />
              <Stat label="Pool SCAD" value={p ? fmtScad(p.scadReserve) : '…'} />
              <Stat label="Pool SOL" value={p ? fmtSol(p.solReserve) : '…'} />
              <Stat label="LP fee" value={p ? `${p.feeBps / 100}%` : '…'} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setTab('trades')}
                className={cn(
                  'text-sm font-semibold',
                  tab === 'trades' ? 'text-foreground' : 'text-foreground-muted',
                )}
              >
                All Trades
              </button>
              <button
                type="button"
                onClick={() => setTab('burns')}
                className={cn(
                  'text-sm font-semibold inline-flex items-center gap-1',
                  tab === 'burns' ? 'text-foreground' : 'text-foreground-muted',
                )}
              >
                <Flame className="h-3.5 w-3.5" />
                Token Burns
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {tab === 'trades' ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border uppercase tracking-wider text-foreground-muted">
                    <th className="text-left px-4 py-2 font-medium">Type</th>
                    <th className="text-right px-4 py-2 font-medium">SCAD</th>
                    <th className="text-right px-4 py-2 font-medium">SOL</th>
                    <th className="text-right px-4 py-2 font-medium">Price</th>
                    <th className="text-right px-4 py-2 font-medium">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {(trades.data ?? []).map((t) => (
                    <tr key={t.signature} className="border-b border-border/30">
                      <td
                        className={cn(
                          'px-4 py-2 font-semibold',
                          t.side === 'buy' ? 'text-success' : 'text-danger',
                        )}
                      >
                        {t.side === 'buy' ? 'Buy' : 'Sell'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{fmtScad(t.scadAmount)}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtSol(t.solAmount)}</td>
                      <td className="px-4 py-2 text-right font-mono">${t.priceUsd.toFixed(6)}</td>
                      <td className="px-4 py-2 text-right">
                        <TxLink sig={t.signature} />
                      </td>
                    </tr>
                  ))}
                  {trades.data?.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-foreground-muted">
                        No trades yet — be the first.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <div>
                <div className="px-4 py-3 text-xs text-foreground-muted border-b border-border/30">
                  Total burned:{' '}
                  <span className="font-mono font-bold text-foreground">
                    {burns.data ? fmtScad(burns.data.totalBurned) : '…'} SCAD
                  </span>{' '}
                  — 20% of net gaming revenue, bought from this pool and burned.
                </div>
                {(burns.data?.burns ?? []).map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between px-4 py-2 border-b border-border/30 text-xs"
                  >
                    <span className="font-mono text-danger">-{fmtScad(b.scadBurned)} SCAD</span>
                    <span className="font-mono text-foreground-muted">
                      {fmtSol(b.solSpent)} SOL
                    </span>
                    {b.burnSignature ? <TxLink sig={b.burnSignature} /> : <span>—</span>}
                  </div>
                ))}
                {burns.data?.burns.length === 0 && (
                  <div className="px-4 py-8 text-center text-foreground-muted text-xs">
                    No burns yet — they run automatically as the house takes revenue.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: swap form */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSide('buy')}
                className={cn(
                  'py-2 rounded-lg text-sm font-bold transition-colors',
                  side === 'buy'
                    ? 'bg-success/20 text-success border border-success/40'
                    : 'bg-surface-elevated text-foreground-muted border border-border',
                )}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setSide('sell')}
                className={cn(
                  'py-2 rounded-lg text-sm font-bold transition-colors',
                  side === 'sell'
                    ? 'bg-danger/20 text-danger border border-danger/40'
                    : 'bg-surface-elevated text-foreground-muted border border-border',
                )}
              >
                Sell
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wider text-foreground-muted">
                {side === 'buy' ? 'Buy for (SOL)' : 'Sell (SCAD)'}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-4 py-3 font-mono text-sm focus:border-primary-400/60 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wider text-foreground-muted">
                Max slippage (%)
              </label>
              <input
                type="number"
                min="0"
                max="50"
                step="0.1"
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-4 py-3 font-mono text-sm focus:border-primary-400/60 focus:outline-none"
              />
            </div>

            <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-foreground-muted">Est. receive</span>
                <span className="font-mono font-semibold">
                  {quote
                    ? side === 'buy'
                      ? `${fmtScad(quote.amountOut)} SCAD`
                      : `${fmtSol(quote.amountOut)} SOL`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-muted">Est. price impact</span>
                <span
                  className={cn(
                    'font-mono',
                    (quote?.priceImpactPct ?? 0) > 5 ? 'text-danger' : 'text-foreground',
                  )}
                >
                  {quote ? `${quote.priceImpactPct.toFixed(2)}%` : '—'}
                </span>
              </div>
            </div>

            <p className="text-[10px] text-foreground-muted">
              Be aware: all buy and sell transactions are processed using your connected wallet.
            </p>

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={busy || !publicKey || !quote}
              onClick={() => void executeSwap()}
            >
              {busy ? 'Swapping…' : side === 'buy' ? 'Buy $SCAD' : 'Sell $SCAD'}
            </Button>

            {error && <p className="text-xs text-danger break-all">{error}</p>}
            {lastSig && (
              <a
                href={solscanTx(lastSig)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary-400 hover:underline break-all"
              >
                View swap on Solscan <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-foreground-muted">{label}</div>
      <div className="text-sm font-bold font-mono">{value}</div>
    </div>
  );
}

function TxLink({ sig }: { sig: string }) {
  return (
    <a
      href={solscanTx(sig)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary-400 hover:underline font-mono"
    >
      {short(sig)} <ExternalLink className="h-3 w-3" />
    </a>
  );
}
