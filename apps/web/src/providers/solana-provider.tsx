'use client';

import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  CoinbaseWalletAdapter,
  TrustWalletAdapter,
  MathWalletAdapter,
  Coin98WalletAdapter,
  NightlyWalletAdapter,
  LedgerWalletAdapter,
  UnsafeBurnerWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { env } from '@/config/env';
import { WalletSessionGuard } from '@/components/wallet/wallet-session-guard';

/**
 * Wraps the app with the Solana wallet-adapter providers.
 *
 * - ConnectionProvider gives child components a shared Solana RPC connection
 *   via the `useConnection()` hook.
 * - WalletProvider manages the set of supported wallet adapters, tracks the
 *   currently selected wallet, and exposes signing/connection methods via
 *   `useWallet()`.
 *
 * Backpack, Glow, and other Wallet-Standard wallets auto-register, so they
 * appear in the picker without an explicit adapter. The UnsafeBurnerWallet is
 * a built-in demo wallet: it generates an in-browser keypair and signs without
 * any extension, so the play-money demo is usable on a fresh machine.
 */
export function SolanaProvider({ children }: { children: ReactNode }) {
  const endpoint = env.solanaRpc;

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new TrustWalletAdapter(),
      new MathWalletAdapter(),
      new Coin98WalletAdapter(),
      new NightlyWalletAdapter(),
      new LedgerWalletAdapter(),
      // Demo wallet — no extension needed; signs in-browser. Devnet/play-money only.
      new UnsafeBurnerWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletSessionGuard />
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
