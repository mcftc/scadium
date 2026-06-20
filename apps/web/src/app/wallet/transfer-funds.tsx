'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useMe } from '@/hooks/use-me';
import { useStatus } from '@/hooks/use-status';
import { buildDepositTx, buildWithdrawTx, userVaultPda } from '@/lib/vault';
import { solscanTx } from '@/lib/explorer';

interface VaultConfig {
  enabled: boolean;
  programId: string | null;
  cluster: string;
  kycEnabled?: boolean;
}
interface VaultBalance {
  vaultLamports: string;
  enabled: boolean;
}

/**
 * Transfer Funds — move SOL between the connected wallet and the on-site
 * vault (insta-wallet). Deposit/withdraw txs are built client-side and
 * signed by the user's wallet; the vault PDA itself enforces that only the
 * owner can withdraw.
 */
export function TransferFunds() {
  const token = useAuthStore((s) => s.accessToken);
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('0.1');
  const [busy, setBusy] = useState<null | 'deposit' | 'withdraw'>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = useQuery({
    queryKey: ['vault', 'config'],
    queryFn: () => api<VaultConfig>('/vault/config'),
    staleTime: 60_000,
  });
  const vaultBalance = useQuery({
    queryKey: ['vault', 'balance'],
    enabled: !!token,
    queryFn: () => api<VaultBalance>('/vault/balance', { token }),
    refetchInterval: 15_000,
  });
  // KYC gate (#45): when KYC is enabled, deposits/withdrawals require approval.
  const { data: me } = useMe();
  const kycBlocked = !!config.data?.kycEnabled && me?.kycStatus !== 'approved';
  // Global pause (#56): block deposits/withdrawals while ops have the kill-switch on.
  const { data: status } = useStatus();
  const paused = !!status?.paused;
  const walletBalance = useQuery({
    queryKey: ['wallet', 'sol', publicKey?.toBase58()],
    enabled: !!publicKey,
    queryFn: async () => connection.getBalance(publicKey!),
    refetchInterval: 15_000,
  });

  // Read the id into a primitive so the memo dep matches the value actually
  // used (the React Compiler otherwise infers `config.data` and skips
  // optimizing this component).
  const programIdStr = config.data?.programId;
  const programId = useMemo(
    () => (programIdStr ? new PublicKey(programIdStr) : null),
    [programIdStr],
  );

  const run = useCallback(
    async (kind: 'deposit' | 'withdraw') => {
      if (!programId || !publicKey) return;
      setError(null);
      setLastSig(null);
      const sol = Number(amount);
      if (!Number.isFinite(sol) || sol <= 0) {
        setError('Enter a valid amount');
        return;
      }
      const lamports = BigInt(Math.round(sol * LAMPORTS_PER_SOL));
      setBusy(kind);
      try {
        const tx =
          kind === 'deposit'
            ? buildDepositTx(programId, publicKey, lamports)
            : buildWithdrawTx(programId, publicKey, lamports);
        const latest = await connection.getLatestBlockhash();
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
        setLastSig(sig);
        // Bridge (#27): tell the API so it verifies the program's own event and
        // credits/debits the custody-backed spendable balance (idempotent on sig).
        await api(kind === 'deposit' ? '/vault/deposit-confirm' : '/vault/withdraw-confirm', {
          method: 'POST',
          token: useAuthStore.getState().accessToken,
          body: { signature: sig },
        });
        void qc.invalidateQueries({ queryKey: ['vault', 'balance'] });
        void qc.invalidateQueries({ queryKey: ['wallet', 'sol'] });
        void qc.invalidateQueries({ queryKey: ['me'] });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [amount, connection, programId, publicKey, qc, sendTransaction],
  );

  if (config.data && !config.data.enabled) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-foreground-muted">
          On-chain vault is not enabled on this server yet.
        </CardContent>
      </Card>
    );
  }

  const vaultSol = vaultBalance.data
    ? Number(BigInt(vaultBalance.data.vaultLamports)) / LAMPORTS_PER_SOL
    : null;
  const walletSol = walletBalance.data != null ? walletBalance.data / LAMPORTS_PER_SOL : null;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {kycBlocked && (
        <Card>
          <CardContent className="py-4 text-sm">
            <span className="font-bold text-amber-400">Verify your identity</span> to deposit or
            withdraw real funds.{' '}
            <Link href="/verify" className="text-primary-400 underline">
              Start verification
            </Link>
            .
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Transfer Funds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-foreground-muted">
            Move SOL between your wallet and your on-site vault. Bets settle against the vault
            instantly — no per-bet wallet confirmations. Only your wallet signature can withdraw.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <BalanceBox label="Wallet balance" sol={walletSol} />
            <BalanceBox label="Vault balance" sol={vaultSol} accent />
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-foreground-muted">
              Amount (SOL)
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

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="primary"
              size="lg"
              disabled={busy !== null || !publicKey || kycBlocked || paused}
              onClick={() => void run('deposit')}
            >
              <ArrowDownToLine className="h-4 w-4" />
              {busy === 'deposit' ? 'Depositing…' : 'Deposit'}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              // Withdrawals are NEVER blocked by the pause (#56): players must
              // always be able to get money out. Only deposits are gated.
              disabled={busy !== null || !publicKey || kycBlocked}
              onClick={() => void run('withdraw')}
            >
              <ArrowUpFromLine className="h-4 w-4" />
              {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
            </Button>
          </div>

          {error && <p className="text-xs text-danger break-all">{error}</p>}
          {lastSig && (
            <a
              href={solscanTx(lastSig)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary-400 hover:underline break-all"
            >
              View transaction on Solscan
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          )}

          {publicKey && programId && (
            <p className="text-[10px] text-foreground-muted/60 font-mono break-all">
              Vault PDA: {userVaultPda(programId, publicKey).toBase58()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BalanceBox({
  label,
  sol,
  accent,
}: {
  label: string;
  sol: number | null;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <div className="text-xs uppercase tracking-wider text-foreground-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold font-mono ${accent ? 'text-gradient' : ''}`}>
        {sol == null ? '…' : `${sol.toFixed(4)} SOL`}
      </div>
    </div>
  );
}
