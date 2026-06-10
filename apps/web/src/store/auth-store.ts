'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  walletAddress: string | null;
  setAuth: (params: {
    accessToken: string;
    refreshToken?: string | null;
    walletAddress: string;
  }) => void;
  /** Update just the token pair after a /auth/refresh rotation (#35). */
  setTokens: (params: { accessToken: string; refreshToken: string }) => void;
  clear: () => void;
  isAuthenticated: () => boolean;
}

/**
 * Persisted auth state. We persist the access token, the (rotating) refresh
 * token, and the wallet address — user-profile data lives in TanStack Query
 * cache and is refetched on mount.
 *
 * Note: storing tokens in localStorage is an acceptable tradeoff for a
 * non-custodial dApp where the wallet itself holds the real secrets. A stolen
 * access token gives a short window that cannot move funds (all bets still
 * require a wallet signature), and the session is server-revocable (#35).
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      walletAddress: null,
      setAuth: ({ accessToken, refreshToken = null, walletAddress }) =>
        set({ accessToken, refreshToken, walletAddress }),
      setTokens: ({ accessToken, refreshToken }) => set({ accessToken, refreshToken }),
      clear: () => set({ accessToken: null, refreshToken: null, walletAddress: null }),
      isAuthenticated: () => get().accessToken !== null,
    }),
    {
      name: 'scadium-auth',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
