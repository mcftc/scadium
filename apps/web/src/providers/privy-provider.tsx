'use client';

import { type ReactNode } from 'react';
import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { env } from '@/config/env';

/**
 * Privy social-login provider (#203). ADDITIVE to SIWS: it wraps the app so the
 * "Continue with Google / Apple" buttons can call Privy's login, but the
 * existing Solana wallet-adapter (SIWS) path is untouched.
 *
 * Gated on `NEXT_PUBLIC_PRIVY_APP_ID`: if it's missing we render children with
 * NO Privy context (the social buttons hide themselves via `usePrivyAuth`), so a
 * deploy without the env var still works — Privy is simply disabled.
 *
 * Config:
 *  - loginMethods: google + apple + external wallet (so users can ALSO reach an
 *    external Solana wallet through Privy if they prefer).
 *  - Solana external-wallet connectors enabled; wallet list scoped to Solana.
 *  - Embedded wallets OFF for now (createOnLogin: 'off') — Privy accounts get a
 *    placeholder address server-side until embedded wallets are turned on.
 */
export function PrivyAppProvider({ children }: { children: ReactNode }) {
  if (!env.privyAppId) return <>{children}</>;

  return (
    <BasePrivyProvider
      appId={env.privyAppId}
      config={{
        loginMethods: ['google', 'apple', 'wallet'],
        appearance: {
          theme: 'dark',
          walletChainType: 'solana-only',
        },
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
        embeddedWallets: {
          solana: { createOnLogin: 'off' },
        },
      }}
    >
      {children}
    </BasePrivyProvider>
  );
}
