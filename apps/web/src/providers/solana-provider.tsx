'use client';

import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  LedgerWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { env } from '@/config/env';

/**
 * Wraps the app with the Solana wallet-adapter providers.
 *
 * - ConnectionProvider gives child components a shared Solana RPC connection
 *   via the `useConnection()` hook.
 * - WalletProvider manages the set of supported wallet adapters, tracks the
 *   currently selected wallet, and exposes signing/connection methods via
 *   `useWallet()`.
 *
 * Backpack is a Wallet Standard wallet so it auto-registers via the
 * `standardWalletConnect` mechanism — no explicit adapter needed.
 */
export function SolanaProvider({ children }: { children: ReactNode }) {
  const endpoint = env.solanaRpc;

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new LedgerWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
