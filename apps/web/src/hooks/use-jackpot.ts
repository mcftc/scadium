'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useSocket } from '@/providers/socket-provider';

export interface JackpotPlayer {
  userId: string;
  username: string | null;
  walletAddress: string;
  amountLamports: string;
  chance: number; // 0..1 share of the pot
}

export interface JackpotResult {
  roundId: string;
  status: 'drawn' | 'refunded';
  winnerName: string | null;
  payoutLamports: string;
  totalLamports: string;
  winningTicket: string | null;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  drawnAt: number;
}

export interface JackpotSnapshot {
  roundId: string;
  status: 'open' | 'drawn' | 'refunded';
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  closeAt: number;
  totalLamports: string;
  playerCount: number;
  config: {
    minEntryLamports: string;
    maxEntryLamports: string;
    houseEdge: number;
    minPlayers: number;
  };
  lastResult: JackpotResult | null;
  players: JackpotPlayer[];
}

export interface MyJackpotRow {
  roundId: string;
  status: 'open' | 'drawn' | 'refunded';
  myAmountLamports: string;
  totalLamports: string;
  won: boolean;
  payoutLamports: string;
  createdAt: string;
}

export interface JackpotRoundRow {
  id: string;
  status: 'drawn' | 'refunded';
  totalLamports: string;
  payoutLamports: string;
  winningTicket: string | null;
  winnerName: string | null;
  winnerWallet: string | null;
  drawnAt: string | null;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export function useJackpot() {
  const [snap, setSnap] = useState<JackpotSnapshot | null>(null);
  const socket = useSocket('/jackpot');
  const qc = useQueryClient();

  useEffect(() => {
    api<JackpotSnapshot>('/jackpot/current').then(setSnap).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refetch = () => api<JackpotSnapshot>('/jackpot/current').then(setSnap).catch(() => {});
    const onEntry = (p: { totalLamports: string; playerCount: number }) =>
      // Patch the cheap fields immediately; refetch to get the full players list.
      setSnap((s) => (s ? { ...s, totalLamports: p.totalLamports, playerCount: p.playerCount } : s));
    const onEntryRefetch = () => refetch();
    const onResult = () => {
      refetch();
      qc.invalidateQueries({ queryKey: ['jackpot', 'mine'] });
      qc.invalidateQueries({ queryKey: ['jackpot', 'recent'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    };
    socket.on('jackpot:round-open', refetch);
    socket.on('jackpot:entry', onEntry);
    socket.on('jackpot:entry', onEntryRefetch);
    socket.on('jackpot:result', onResult);
    return () => {
      socket.off('jackpot:round-open', refetch);
      socket.off('jackpot:entry', onEntry);
      socket.off('jackpot:entry', onEntryRefetch);
      socket.off('jackpot:result', onResult);
    };
  }, [socket, qc]);

  return snap;
}

export function useEnterJackpot() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountLamports: string) =>
      api('/jackpot/enter', { method: 'POST', body: { amountLamports }, token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['jackpot', 'mine'] });
    },
  });
}

export function useMyJackpot() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['jackpot', 'mine'],
    enabled: !!token,
    queryFn: () => api<MyJackpotRow[]>('/jackpot/my-entries', { token }),
  });
}

export function useJackpotRecent() {
  return useQuery({
    queryKey: ['jackpot', 'recent'],
    queryFn: () => api<JackpotRoundRow[]>('/jackpot/recent'),
    staleTime: 15_000,
  });
}
