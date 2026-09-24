'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { parseSolToLamports } from '@/components/instant/bet-amount-input';
import { useMe } from '@/hooks/use-me';
import { useStatus } from '@/hooks/use-status';
import {
  useConfirmDeposit,
  useCustodyConfig,
  useCustodyTransfers,
  useScanDeposits,
  useWithdraw,
  type CustodyConfig,
  type CustodyTransfer,
  type HoldReason,
} from '@/hooks/use-custody';
import { formatSol } from '@/lib/format';
import { solscanTx } from '@/lib/explorer';
import { env } from '@/config/env';

const HOLD_COPY: Record<HoldReason, string> = {
  unattributed:
    'Sent from a wallet that is not linked to your account — link it in Settings and it is credited.',
  ambiguous_sender:
    'Signed by wallets of more than one account, so it cannot be credited automatically — contact support.',
  below_minimum: 'Below the minimum deposit, so it is not credited.',
  paused: 'Deposits are paused for maintenance — it is credited automatically afterwards.',
  deposit_limit: 'Over your daily deposit limit — credited automatically once the limit allows.',
  age_unverified: 'Confirm you are 18+ to have it credited.',
  open_play_positions:
    'You still have play-money bets running — it is credited as soon as they finish.',
};

const STATUS_COPY: Record<CustodyTransfer['status'], string> = {
  held: 'On hold',
  credited: 'Credited',
  pending: 'Queued',
  sent: 'Sending',
  confirmed: 'Sent',
  failed: 'Refunded',
};

/**
 * Wallet page (ADR 0005): deposit SOL from the connected wallet to the site
 * balance, withdraw it back to the account's wallet. Deposits are ordinary
 * transfers to the treasury, verified on chain by the API; withdrawals are sent
 * by the server. On devnet everything is test SOL with no value.
 */
export function TransferFunds() {
  const cfg = useCustodyConfig();
  const { data: me } = useMe();

  if (!cfg.data) return <p className="text-center text-foreground-muted">Loading…</p>;
  if (!cfg.data.enabled) {
    return (
      <Notice>
        Wallet deposits are not open here yet — the site runs on play money for now.
      </Notice>
    );
  }
  if (!cfg.data.active) {
    return <Notice>Wallet deposits are offline right now: {cfg.data.inactiveReason}.</Notice>;
  }
  return (
    <div className="max-w-xl mx-auto space-y-6">
      {cfg.data.cluster !== 'mainnet-beta' && <TestNetworkGuide />}
      <Balances funded={!!me?.funded} siteLamports={me?.playBalanceLamports ?? null} />
      <Deposit cfg={cfg.data} funded={!!me?.funded} accountWallet={me?.walletAddress ?? null} />
      {me?.funded && <Withdraw cfg={cfg.data} wallet={me.walletAddress} />}
      <History />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Card className="max-w-xl mx-auto">
      <CardContent className="py-10 text-center text-foreground-muted">{children}</CardContent>
    </Card>
  );
}

function TestNetworkGuide() {
  return (
    <Card>
      <CardContent className="py-4 space-y-2 text-sm">
        <p>
          <span className="font-bold text-amber-400">Test network.</span> Deposits and withdrawals
          use devnet SOL, which has no real value. Switch your wallet to devnet first:
        </p>
        <ul className="list-disc pl-5 text-foreground-muted space-y-1">
          <li>Phantom: Settings → Developer Settings → Testnet Mode on → Solana Devnet.</li>
          <li>Solflare: Settings → General → Network → Devnet.</li>
          <li>
            Free test SOL:{' '}
            <a
              href="https://faucet.solana.com"
              target="_blank"
              rel="noreferrer"
              className="text-primary-400 underline"
            >
              faucet.solana.com
            </a>{' '}
            (paste your wallet address, choose devnet).
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

function Balances({ funded, siteLamports }: { funded: boolean; siteLamports: string | null }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const wallet = useQuery({
    queryKey: ['wallet', 'sol', publicKey?.toBase58()],
    enabled: !!publicKey,
    queryFn: async () => connection.getBalance(publicKey!),
    refetchInterval: 15_000,
  });
  return (
    <div className="grid grid-cols-2 gap-4">
      <BalanceBox
        label="Wallet"
        value={wallet.data != null ? `${(wallet.data / LAMPORTS_PER_SOL).toFixed(4)} SOL` : '…'}
      />
      <BalanceBox
        label={funded ? 'Site balance' : 'Play money'}
        value={siteLamports != null ? `${formatSol(siteLamports, 4)} SOL` : '…'}
        accent
      />
    </div>
  );
}

function BalanceBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <div className="text-xs uppercase tracking-wider text-foreground-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold font-mono ${accent ? 'text-gradient' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function AmountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Amount in SOL"
      className="w-full rounded-xl border border-border bg-surface-elevated px-4 py-3 font-mono text-sm focus:border-primary-400/60 focus:outline-none"
    />
  );
}

function Deposit({
  cfg,
  funded,
  accountWallet,
}: {
  cfg: CustodyConfig;
  funded: boolean;
  accountWallet: string | null;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { data: status } = useStatus();
  const confirm = useConfirmDeposit();
  const scan = useScanDeposits();
  const [amount, setAmount] = useState('0.1');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const otherWallet = !!publicKey && !!accountWallet && publicKey.toBase58() !== accountWallet;
  // This page was built for one network; the API proved which one it runs on.
  // If they ever differ, a deposit would go to the treasury address on the
  // wrong network and never be credited — so refuse.
  const wrongNetwork = cfg.cluster !== env.solanaNetwork;

  async function deposit() {
    setError(null);
    setMessage(null);
    const lamports = parseSolToLamports(amount);
    if (lamports == null || lamports < BigInt(cfg.minDepositLamports)) {
      setError(`Enter at least ${formatSol(cfg.minDepositLamports)} SOL`);
      return;
    }
    if (!publicKey || !cfg.treasury || wrongNetwork) return;
    setSending(true);
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(cfg.treasury),
          lamports,
        }),
      );
      const latest = await connection.getLatestBlockhash();
      const signature = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
      setMessage('Sent — waiting for the network to finalize it…');
      const r = await confirm.mutateAsync(signature);
      if (!('id' in r)) setMessage('Still finalizing — it will be credited automatically.');
      else if (r.status === 'credited') setMessage('Deposit credited.');
      else setMessage(r.heldReason ? HOLD_COPY[r.heldReason] : 'Deposit received, on hold.');
    } catch (e) {
      setMessage(null);
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deposit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!funded && (
          <p className="text-sm text-foreground-muted">
            Your first deposit <span className="text-foreground">replaces your play-money
            balance</span>: from then on your balance is SOL you can withdraw. Play money cannot be
            withdrawn. Jackpot and lottery are played with deposited SOL only.
          </p>
        )}
        {wrongNetwork && (
          <p className="text-xs text-danger">
            Deposits run on {cfg.cluster} but this page was built for {env.solanaNetwork} — deposits
            are disabled here until that is fixed.
          </p>
        )}
        {otherWallet && (
          <p className="text-xs text-amber-400">
            The connected wallet is not your account&apos;s wallet. A deposit from it is credited
            only if the wallet is linked to your account.
          </p>
        )}
        <AmountInput value={amount} onChange={setAmount} />
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={sending || !publicKey || !!status?.paused || wrongNetwork}
          onClick={() => void deposit()}
        >
          <ArrowDownToLine className="h-4 w-4" />
          {!publicKey ? 'Connect your wallet' : sending ? 'Depositing…' : 'Deposit'}
        </Button>
        {message && <p className="text-sm">{message}</p>}
        {error && <p className="text-xs text-danger break-all">{error}</p>}
        <button
          type="button"
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
          className="inline-flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground"
        >
          <RefreshCw className={`h-3 w-3 ${scan.isPending ? 'animate-spin' : ''}`} />
          Sent SOL but it is not here? Check again
        </button>
      </CardContent>
    </Card>
  );
}

function Withdraw({ cfg, wallet }: { cfg: CustodyConfig; wallet: string }) {
  const withdraw = useWithdraw();
  const [amount, setAmount] = useState('0.1');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const lamports = parseSolToLamports(amount);
    if (lamports == null || lamports < BigInt(cfg.minWithdrawLamports)) {
      setError(`Enter at least ${formatSol(cfg.minWithdrawLamports)} SOL`);
      return;
    }
    withdraw.mutate(lamports.toString(), { onError: (e) => setError(e.message) });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withdraw</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-foreground-muted">
          Sent to your account&apos;s wallet{' '}
          <span className="font-mono text-foreground">
            {wallet.slice(0, 4)}…{wallet.slice(-4)}
          </span>
          . Up to {formatSol(cfg.maxWithdrawLamports, 2)} SOL per withdrawal and{' '}
          {formatSol(cfg.dailyWithdrawLamports, 2)} SOL a day.
        </p>
        <AmountInput value={amount} onChange={setAmount} />
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={withdraw.isPending}
          onClick={submit}
        >
          <ArrowUpFromLine className="h-4 w-4" />
          {withdraw.isPending ? 'Requesting…' : 'Withdraw'}
        </Button>
        {error && <p className="text-xs text-danger break-all">{error}</p>}
      </CardContent>
    </Card>
  );
}

function History() {
  const { data } = useCustodyTransfers();
  if (!data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {data.map((t) => (
          <div key={t.id} className="py-3 text-sm space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">
                {t.kind === 'deposit' ? 'Deposit' : 'Withdrawal'}{' '}
                <span className="font-mono">{formatSol(t.amountLamports, 4)} SOL</span>
              </span>
              <span className="text-xs text-foreground-muted">{STATUS_COPY[t.status]}</span>
            </div>
            {t.heldReason && t.status === 'held' && (
              <p className="text-xs text-amber-400">{HOLD_COPY[t.heldReason]}</p>
            )}
            <div className="flex items-center justify-between text-xs text-foreground-muted">
              <span>{new Date(t.createdAt).toLocaleString()}</span>
              {t.txSignature && (
                <a
                  href={solscanTx(t.txSignature)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary-400 hover:underline"
                >
                  Explorer <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
