'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useSocket } from '@/providers/socket-provider';

export interface LotteryLastResult {
  drawId: string;
  mainNumbers: number[];
  bonusNumber: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  winnersCount: number;
  drawnAt: number;
}

export interface LotterySnapshot {
  drawId: string;
  status: 'open' | 'drawn';
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  drawAt: number;
  ticketCount: number;
  potLamports: string;
  ticketPriceLamports: string;
  ticketPriceUsd: number;
  config: {
    mainCount: number;
    mainMax: number;
    bonusMax: number;
    prizes: Record<string, number>;
  };
  lastResult: LotteryLastResult | null;
}

export interface MyLotteryTicket {
  id: string;
  drawId: string;
  mainNumbers: number[];
  bonusNumber: number;
  costLamports: string;
  matchedMain: number;
  matchedBonus: number;
  payoutLamports: string;
  won: boolean;
  drawStatus: 'open' | 'drawn';
  drawMain: number[];
  drawBonus: number | null;
  createdAt: string;
}

export interface LotteryDrawRow {
  id: string;
  mainNumbers: number[];
  bonusNumber: number | null;
  ticketCount: number;
  potLamports: string;
  drawnAt: string | null;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/** Live current-draw state, seeded from REST and patched over Socket.io. */
export function useLottery() {
  const [snap, setSnap] = useState<LotterySnapshot | null>(null);
  const socket = useSocket('/lottery');
  const qc = useQueryClient();

  useEffect(() => {
    api<LotterySnapshot>('/lottery/current').then(setSnap).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refetch = () => api<LotterySnapshot>('/lottery/current').then(setSnap).catch(() => {});
    const onTicket = (p: { ticketCount: number; potLamports: string }) =>
      setSnap((s) => (s ? { ...s, ticketCount: p.ticketCount, potLamports: p.potLamports } : s));
    const onResult = () => {
      refetch();
      qc.invalidateQueries({ queryKey: ['lottery', 'my-tickets'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'recent'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    };
    socket.on('lottery:draw-open', refetch);
    socket.on('lottery:ticket-sold', onTicket);
    socket.on('lottery:draw-result', onResult);
    return () => {
      socket.off('lottery:draw-open', refetch);
      socket.off('lottery:ticket-sold', onTicket);
      socket.off('lottery:draw-result', onResult);
    };
  }, [socket, qc]);

  return snap;
}

export function useBuyTicket() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { mainNumbers: number[]; bonusNumber: number }) =>
      api('/lottery/ticket', { method: 'POST', body: params, token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'my-tickets'] });
    },
  });
}

export function useMyLotteryTickets() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['lottery', 'my-tickets'],
    enabled: !!token,
    queryFn: () => api<MyLotteryTicket[]>('/lottery/my-tickets', { token }),
  });
}

export function useRecentDraws() {
  return useQuery({
    queryKey: ['lottery', 'recent'],
    queryFn: () => api<LotteryDrawRow[]>('/lottery/recent'),
    staleTime: 15_000,
  });
}
