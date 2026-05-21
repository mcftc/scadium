'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  walletAddress: string | null;
  setAuth: (params: { accessToken: string; walletAddress: string }) => void;
  clear: () => void;
  isAuthenticated: () => boolean;
}

/**
 * Persisted auth state. We only persist the access token + wallet address —
 * user-profile data lives in TanStack Query cache and is refetched on mount.
 *
 * Note: storing JWTs in localStorage is an acceptable tradeoff for a
 * non-custodial dApp where the wallet itself holds the real secrets. A
 * stolen JWT gives a 15-minute window that cannot move funds (all bets
 * still require a wallet signature).
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      walletAddress: null,
      setAuth: ({ accessToken, walletAddress }) => set({ accessToken, walletAddress }),
      clear: () => set({ accessToken: null, walletAddress: null }),
      isAuthenticated: () => get().accessToken !== null,
    }),
    {
      name: 'scadium-auth',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
