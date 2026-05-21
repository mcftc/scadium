'use client';

import type { ReactNode } from 'react';
import { SolanaProvider } from './solana-provider';
import { QueryProvider } from './query-provider';
import { SocketProvider } from './socket-provider';
import { WalletModalProvider } from '@/components/wallet/wallet-modal-provider';

/**
 * Top-level client provider tree. Order matters — QueryProvider is outermost
 * so any hook (including wallet-adapter listeners) can use it, SolanaProvider
 * sits in the middle so its useConnection/useWallet hooks are available to
 * both data queries and the wallet modal.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <SolanaProvider>
        <SocketProvider>
          <WalletModalProvider>{children}</WalletModalProvider>
        </SocketProvider>
      </SolanaProvider>
    </QueryProvider>
  );
}
