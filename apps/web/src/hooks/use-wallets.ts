'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

export interface WalletEntry {
  address: string;
  primary: boolean;
}
interface WalletsResponse {
  wallets: WalletEntry[];
}

export function useWallets() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['me', 'wallets'],
    enabled: !!token,
    queryFn: () => api<WalletsResponse>('/me/wallets', { token }),
  });
}

/**
 * Link the currently-connected wallet to this account: fetch a SIWS nonce
 * for its address, sign it, and submit. Linking a different wallet means
 * connecting it first, then running this.
 */
export function useLinkWallet() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const { publicKey, signMessage, connected } = useWallet();
  return useMutation({
    mutationFn: async () => {
      if (!connected || !publicKey) throw new Error('Connect a wallet first');
      if (!signMessage) throw new Error('This wallet cannot sign messages');
      const address = publicKey.toBase58();
      const { nonce, message } = await api<{ nonce: string; message: string }>(
        '/me/wallets/nonce',
        { method: 'POST', body: { address }, token },
      );
      const sig = await signMessage(new TextEncoder().encode(message));
      return api<WalletsResponse>('/me/wallets/link', {
        method: 'POST',
        body: { address, message, signature: bs58.encode(sig), nonce },
        token,
      });
    },
    onSuccess: (res) => qc.setQueryData(['me', 'wallets'], res),
  });
}

export function useSetPrimaryWallet() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (address: string) =>
      api<WalletsResponse>('/me/wallets/primary', { method: 'POST', body: { address }, token }),
    onSuccess: (res) => qc.setQueryData(['me', 'wallets'], res),
  });
}

export function useUnlinkWallet() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (address: string) =>
      api<WalletsResponse>(`/me/wallets/${address}`, { method: 'DELETE', token }),
    onSuccess: (res) => qc.setQueryData(['me', 'wallets'], res),
  });
}
