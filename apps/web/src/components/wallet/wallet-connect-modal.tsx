'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet, type Wallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in';
import { PrivySocialButtons } from './privy-social-buttons';
import { env } from '@/config/env';
import { cn } from '@/lib/cn';

interface WalletConnectModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'choose' | 'connecting' | 'signing' | 'success' | 'error';

/**
 * Two-step connect flow:
 *
 *   1. User picks a wallet from the list.
 *   2. Wallet adapter connects → we immediately request a SIWS nonce,
 *      prompt the user to sign it, and POST the signature to /auth/verify.
 *
 * If any step fails we surface the error inline and let the user retry
 * without re-selecting a wallet.
 */
export function WalletConnectModal({ open, onClose }: WalletConnectModalProps) {
  const { wallets, select, connect, connected, connecting, disconnect, wallet } = useWallet();
  const { signIn } = useSiwsSignIn();
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);
  const connectStartedRef = useRef(false);

  // Reset state whenever the modal opens afresh
  useEffect(() => {
    if (open) {
      setStep('choose');
      setError(null);
      connectStartedRef.current = false;
    }
  }, [open]);

  // `select()` only sets the active wallet on the *next* render — calling
  // connect() synchronously after it throws WalletNotSelectedError. So we wait
  // until the chosen wallet is actually selected, then connect exactly once.
  //
  // The connect() call is deferred a tick: this child effect runs *before* the
  // WalletProvider re-attaches its 'connect' listener to the newly selected
  // adapter, and wallets that connect synchronously (the burner) emit 'connect'
  // during connect() itself — the event would be lost and `connected` would
  // never flip, leaving the modal stuck on "Connecting…".
  useEffect(() => {
    if (!open || step !== 'connecting') return;
    if (!wallet || connected || connecting) return;
    if (connectStartedRef.current) return;
    const t = setTimeout(() => {
      connectStartedRef.current = true;
      connect().catch((e) => {
        connectStartedRef.current = false;
        setStep('error');
        setError(e instanceof Error ? e.message : 'Failed to connect to wallet');
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open, step, wallet, connected, connecting, connect]);

  // After the wallet adapter reports `connected: true`, kick off SIWS
  useEffect(() => {
    if (!open) return;
    if (connected && step === 'connecting') {
      void runSiws();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, step, open]);

  async function runSiws() {
    setStep('signing');
    setError(null);
    try {
      await signIn();
      setStep('success');
      setTimeout(() => onClose(), 800);
    } catch (e) {
      setStep('error');
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      // Disconnect so the user can retry cleanly
      try {
        await disconnect();
      } catch {
        /* noop */
      }
    }
  }

  // Privy (Google/Apple) finished its own login + JWT exchange (#203) — reuse the
  // same success → auto-close UX as SIWS.
  function handlePrivySuccess() {
    setStep('success');
    setTimeout(() => onClose(), 800);
  }

  function handleChoose(w: Wallet) {
    setError(null);
    connectStartedRef.current = false;
    setStep('connecting');
    // Just select here — the effect above connects once selection lands. If
    // this wallet is already the active one, nudge the connect effect directly.
    select(w.adapter.name);
  }

  const installedWallets = wallets.filter(
    (w) =>
      w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );
  const otherWallets = wallets.filter((w) => w.readyState === WalletReadyState.NotDetected);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect your wallet"
      description="Non-custodial sign-in. We'll ask you to sign a message — no transaction, no fees."
    >
      {step === 'choose' && (
        <div className="space-y-2">
          {env.privyAppId && <PrivySocialButtons onSuccess={handlePrivySuccess} />}
          {installedWallets.length === 0 && otherWallets.length === 0 && (
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-center text-sm text-foreground-muted">
              No Solana wallets detected. Install{' '}
              <a
                href="https://phantom.app/"
                target="_blank"
                rel="noreferrer"
                className="text-primary-400 underline"
              >
                Phantom
              </a>{' '}
              to get started.
            </div>
          )}
          {installedWallets.map((w) => (
            <WalletRow key={w.adapter.name} wallet={w} onSelect={() => handleChoose(w)} />
          ))}
          {otherWallets.length > 0 && (
            <div className="pt-2 mt-2 border-t border-border">
              <p className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
                Not installed
              </p>
              {otherWallets.map((w) => (
                <WalletRow key={w.adapter.name} wallet={w} onSelect={() => handleChoose(w)} />
              ))}
            </div>
          )}
        </div>
      )}

      {(step === 'connecting' || step === 'signing') && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="h-10 w-10 text-primary-400 animate-spin" />
          <div className="text-center">
            <p className="font-semibold">
              {step === 'connecting' ? 'Connecting…' : 'Sign to authenticate'}
            </p>
            <p className="text-sm text-foreground-muted mt-1">
              {step === 'connecting'
                ? `Approve the connection in ${wallet?.adapter.name ?? 'your wallet'}`
                : "Check your wallet for a signature request. This doesn't cost anything."}
            </p>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <CheckCircle2 className="h-10 w-10 text-success" />
          <p className="font-semibold">Signed in</p>
        </div>
      )}

      {step === 'error' && (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4">
            <AlertCircle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-danger">Connection failed</p>
              <p className="text-foreground-muted mt-1">{error}</p>
            </div>
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setStep('choose')}>
            Try again
          </Button>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-foreground-muted">
        Supported: Phantom, Solflare, Ledger, and any Wallet Standard–compliant wallet.
      </p>
    </Dialog>
  );
}

function WalletRow({ wallet, onSelect }: { wallet: Wallet; onSelect: () => void }) {
  const installed =
    wallet.readyState === WalletReadyState.Installed ||
    wallet.readyState === WalletReadyState.Loadable;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 rounded-xl border border-border bg-surface-elevated p-4 text-left transition-colors',
        'hover:border-primary-400/50 hover:bg-surface',
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={wallet.adapter.icon} alt="" className="h-9 w-9 rounded-lg" />
      <div className="flex-1">
        <p className="font-semibold">{wallet.adapter.name}</p>
        <p className="text-xs text-foreground-muted">{installed ? 'Detected' : 'Not installed'}</p>
      </div>
    </button>
  );
}
