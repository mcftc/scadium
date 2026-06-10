'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback } from 'react';
import { useAuthStore } from '@/store/auth-store';
import { api } from '@/lib/api-client';

/**
 * Convenience hook that unifies wallet-adapter state and our auth store.
 *
 * The JWT is the session of record: it's issued only after a SIWS signature,
 * so once a user has signed in, the short-lived token *is* their identity.
 * The wallet adapter only needs to be connected at sign-in time (to produce
 * that signature) — keeping it live afterwards isn't required to browse the
 * authenticated app. This also means a regenerating demo (burner) wallet, or a
 * page reload that drops the adapter connection, doesn't log the user out.
 *
 * - `isAuthenticated` ⇔ we hold a JWT + the wallet address it was issued for.
 * - `signOut` clears the JWT and disconnects the wallet adapter.
 */
export function useWalletAuth() {
  const { publicKey, disconnect } = useWallet();
  const { accessToken, walletAddress, clear } = useAuthStore();

  // Revoke the server session (#35) so a stolen token can't outlive sign-out,
  // then clear local state + disconnect the adapter. `scope: 'all'` logs out
  // every device (logout-everywhere).
  const endSession = useCallback(
    async (scope: 'current' | 'all') => {
      const token = useAuthStore.getState().accessToken;
      if (token) {
        try {
          await api(scope === 'all' ? '/auth/logout-all' : '/auth/logout', { method: 'POST', token });
        } catch {
          /* best-effort: clear locally even if the revoke call fails */
        }
      }
      clear();
      try {
        await disconnect();
      } catch {
        /* ignore disconnect errors */
      }
    },
    [clear, disconnect],
  );

  const signOut = useCallback(() => endSession('current'), [endSession]);
  const signOutEverywhere = useCallback(() => endSession('all'), [endSession]);

  const isAuthenticated = !!accessToken && !!walletAddress;

  return {
    isAuthenticated,
    // Prefer the address the JWT was issued for; fall back to a live adapter.
    walletAddress: walletAddress ?? publicKey?.toBase58() ?? null,
    accessToken,
    signOut,
    signOutEverywhere,
  };
}
