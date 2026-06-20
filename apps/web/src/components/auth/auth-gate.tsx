'use client';

import { type ReactNode } from 'react';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useHydrated } from '@/hooks/use-hydrated';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';

/**
 * Client-side auth gate. Renders `children` only when the user is signed in;
 * otherwise shows an empty-state with a prompt to connect.
 *
 * We hydrate-gate with `mounted` so the gate doesn't flash the signed-out
 * state on first render for authenticated users (the zustand persist store
 * hydrates after mount).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useWalletAuth();
  const { open } = useWalletModal();
  const mounted = useHydrated();

  if (!mounted) {
    return <div className="py-24 text-center text-foreground-muted">Loading…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="py-24 flex flex-col items-center text-center">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-400/10 border border-primary-400/30">
          <Wallet className="h-8 w-8 text-primary-400" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Connect your wallet</h2>
        <p className="text-foreground-muted mb-6 max-w-md">
          Sign in with Phantom, Solflare, or Ledger to access your profile, bet history, and stats.
        </p>
        <Button size="lg" onClick={open}>
          <Wallet className="h-5 w-5" />
          Connect Wallet
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
