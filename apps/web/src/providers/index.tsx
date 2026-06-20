'use client';

import type { ReactNode } from 'react';
import { SolanaProvider } from './solana-provider';
import { QueryProvider } from './query-provider';
import { SocketProvider } from './socket-provider';
import { PrivyAppProvider } from './privy-provider';
import { WalletModalProvider } from '@/components/wallet/wallet-modal-provider';

/**
 * Top-level client provider tree. Order matters — QueryProvider is outermost
 * so any hook (including wallet-adapter listeners) can use it, SolanaProvider
 * sits in the middle so its useConnection/useWallet hooks are available to
 * both data queries and the wallet modal.
 *
 * PrivyAppProvider (#203) wraps the connect modal so its Google/Apple buttons can
 * call Privy's login. It's a no-op passthrough when NEXT_PUBLIC_PRIVY_APP_ID is
 * unset, so SIWS wallet auth is unaffected whether or not Privy is configured.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <SolanaProvider>
        <SocketProvider>
          <PrivyAppProvider>
            <WalletModalProvider>{children}</WalletModalProvider>
          </PrivyAppProvider>
        </SocketProvider>
      </SolanaProvider>
    </QueryProvider>
  );
}
