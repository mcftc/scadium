'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback, useEffect } from 'react';
import { useAuthStore } from '@/store/auth-store';

/**
 * Convenience hook that unifies wallet-adapter state and our auth store.
 *
 * - `isAuthenticated` means both the wallet is connected AND we hold a
 *   matching JWT for its address. If the user disconnects their wallet
 *   (or connects a different one), we invalidate any stale session.
 * - `signOut` clears the JWT and disconnects the wallet adapter.
 */
export function useWalletAuth() {
  const { connected, publicKey, disconnect } = useWallet();
  const { accessToken, walletAddress, clear } = useAuthStore();

  const currentWalletAddress = publicKey?.toBase58() ?? null;

  // If the connected wallet no longer matches the authenticated wallet,
  // drop the JWT — it belongs to a different identity.
  useEffect(() => {
    if (!connected) return;
    if (walletAddress && currentWalletAddress && walletAddress !== currentWalletAddress) {
      clear();
    }
  }, [connected, currentWalletAddress, walletAddress, clear]);

  const signOut = useCallback(async () => {
    clear();
    try {
      await disconnect();
    } catch {
      /* ignore disconnect errors */
    }
  }, [clear, disconnect]);

  const isAuthenticated =
    connected && !!accessToken && !!walletAddress && walletAddress === currentWalletAddress;

  return {
    isAuthenticated,
    walletAddress: currentWalletAddress,
    accessToken,
    signOut,
  };
}
