'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useSocket } from '@/providers/socket-provider';

export interface CoinflipGame {
  id: string;
  creatorId: string;
  creatorUsername: string | null;
  creatorWallet: string | null;
  creatorSide: 'heads' | 'tails';
  joinerId: string | null;
  joinerUsername: string | null;
  joinerWallet: string | null;
  amountLamports: string;
  result: 'heads' | 'tails' | null;
  winnerId: string | null;
  status: 'open' | 'matched' | 'resolving' | 'completed' | 'cancelled';
  createdAt: string;
  resolvedAt: string | null;
  serverSeedHash: string | null;
  serverSeed: string | null;
  clientSeed: string | null;
  nonce: number | null;
}

/**
 * Realtime-backed hook for the open-flip lobby. Seeds from the REST list
 * endpoint, then patches the cache on every `flip:created` /
 * `flip:resolved` / `flip:cancelled` socket event so the UI never needs a
 * refetch during the session.
 */
export function useOpenCoinflips() {
  const qc = useQueryClient();
  const socket = useSocket('/coinflip');

  const query = useQuery({
    queryKey: ['coinflip', 'open'],
    queryFn: () => api<CoinflipGame[]>('/coinflip/open'),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!socket) return;
    const onCreated = (game: CoinflipGame) => {
      qc.setQueryData<CoinflipGame[]>(['coinflip', 'open'], (prev) => {
        if (!prev) return [game];
        if (prev.some((g) => g.id === game.id)) return prev;
        return [game, ...prev];
      });
    };
    const onResolved = (game: CoinflipGame) => {
      qc.setQueryData<CoinflipGame[]>(['coinflip', 'open'], (prev) =>
        prev ? prev.filter((g) => g.id !== game.id) : prev,
      );
      qc.setQueryData<CoinflipGame[]>(['coinflip', 'recent'], (prev) => {
        if (!prev) return [game];
        return [game, ...prev].slice(0, 20);
      });
      // Bet history + balance both changed for the winning/losing users
      qc.invalidateQueries({ queryKey: ['me'] });
    };
    const onCancelled = ({ id }: { id: string }) => {
      qc.setQueryData<CoinflipGame[]>(['coinflip', 'open'], (prev) =>
        prev ? prev.filter((g) => g.id !== id) : prev,
      );
    };

    socket.on('flip:created', onCreated);
    socket.on('flip:resolved', onResolved);
    socket.on('flip:cancelled', onCancelled);
    return () => {
      socket.off('flip:created', onCreated);
      socket.off('flip:resolved', onResolved);
      socket.off('flip:cancelled', onCancelled);
    };
  }, [socket, qc]);

  return query;
}

export function useRecentCoinflips() {
  return useQuery({
    queryKey: ['coinflip', 'recent'],
    queryFn: () => api<CoinflipGame[]>('/coinflip/recent'),
    staleTime: 10_000,
  });
}

export function useCreateCoinflip() {
  const token = useAuthStore((s) => s.accessToken);
  return useMutation({
    mutationFn: (params: { side: 'heads' | 'tails'; amountLamports: string }) =>
      api<CoinflipGame>('/coinflip', {
        method: 'POST',
        body: params,
        token,
      }),
  });
}

export function useJoinCoinflip() {
  const token = useAuthStore((s) => s.accessToken);
  return useMutation({
    mutationFn: (gameId: string) =>
      api<CoinflipGame>(`/coinflip/${gameId}/join`, {
        method: 'POST',
        token,
      }),
  });
}

export function useCancelCoinflip() {
  const token = useAuthStore((s) => s.accessToken);
  return useMutation({
    mutationFn: (gameId: string) =>
      api<CoinflipGame>(`/coinflip/${gameId}/cancel`, {
        method: 'POST',
        token,
      }),
  });
}
