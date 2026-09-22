'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useSocket } from '@/providers/socket-provider';

/**
 * Live game counters from `GET /platform/live`.
 *
 * Every game key is OPTIONAL: the API reports only the games it actually
 * serves (see apps/api/src/platform/platform.service.ts), so a game that is
 * switched off via ENABLED_GAMES is absent rather than null. Typing these as
 * always-present would be a lie the compiler then helps you believe — and the
 * first mismatched roster between the API and a web build would be a runtime
 * TypeError in the header, not a caught error.
 */
export interface PlatformLive {
  crash?: { phase: string; multiplier: number | null };
  coinflip?: { openCount: number };
  blackjack?: { active: number };
  jackpot?: { status: 'waiting' | 'open'; players: number };
  lottery?: { drawAt: number; ticketPriceUsd: number };
  totalBets: number;
}

/** Live game counters for the header Games dropdown + total-bets ticker. */
export function usePlatformLive() {
  return useQuery({
    queryKey: ['platform', 'live'],
    queryFn: () => api<PlatformLive>('/platform/live'),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
}

export interface AirdropPool {
  period: string;
  poolLamports: string;
  tipsCount: number;
  endsAt: number;
}

export interface AirdropDrop {
  totalLamports: string;
  participantCount: number;
  perUserLamports: string;
}

/**
 * Live hourly airdrop pool for the left-rail widget. Seeded from REST and
 * patched over the `/airdrop` socket namespace; `lastDrop` carries the most
 * recent distribution so the UI can toast it.
 */
export function useAirdropPool() {
  const [pool, setPool] = useState<AirdropPool | null>(null);
  const [lastDrop, setLastDrop] = useState<AirdropDrop | null>(null);
  const socket = useSocket('/airdrop');
  const qc = useQueryClient();

  useEffect(() => {
    api<AirdropPool>('/airdrop/pool').then(setPool).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onPool = (p: { poolLamports: string; endsAt: number; tipsCount: number }) =>
      setPool((cur) => ({ period: cur?.period ?? '', ...p }));
    const onDropped = (d: AirdropDrop) => {
      setLastDrop(d);
      qc.invalidateQueries({ queryKey: ['me'] });
    };
    socket.on('airdrop:pool', onPool);
    socket.on('airdrop:dropped', onDropped);
    return () => {
      socket.off('airdrop:pool', onPool);
      socket.off('airdrop:dropped', onDropped);
    };
  }, [socket, qc]);

  return { pool, lastDrop };
}
