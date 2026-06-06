'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

export interface MeResponse {
  id: string;
  walletAddress: string;
  username: string | null;
  avatarUrl: string | null;
  role: 'user' | 'moderator' | 'admin';
  refCode: string;
  referredBy: string | null;
  banned: boolean;
  createdAt: string;
  stats: {
    totalWageredLamports: string;
    totalWonLamports: string;
    totalLostLamports: string;
    biggestWinLamports: string;
    gamesPlayed: number;
  };
  scadiumBalance: string;
  playBalanceLamports: string;
  xp: number;
  level: number;
  xpCurrentLevelFloor: number;
  xpNextLevelAt: number;
}

export interface BetRow {
  id: string;
  gameType: 'crash' | 'coinflip' | 'blackjack' | 'lottery' | 'jackpot';
  amountLamports: string;
  payoutLamports: string;
  multiplier: number | null;
  status: 'pending' | 'won' | 'lost' | 'refunded';
  txSignature: string | null;
  createdAt: string;
  resultJson: unknown;
}

export interface BetListResponse {
  items: BetRow[];
  nextCursor: string | null;
}

export interface StatsResponse {
  totalWageredLamports: string;
  totalWonLamports: string;
  totalLostLamports: string;
  biggestWinLamports: string;
  gamesPlayed: number;
  netLamports: string;
}

export function useMe() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['me'],
    enabled: !!token,
    queryFn: () => api<MeResponse>('/me', { token }),
  });
}

export function useMyBets(limit = 20) {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['me', 'bets', limit],
    enabled: !!token,
    queryFn: () => api<BetListResponse>(`/me/bets?limit=${limit}`, { token }),
  });
}

export function useMyStats() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['me', 'stats'],
    enabled: !!token,
    queryFn: () => api<StatsResponse>('/me/stats', { token }),
  });
}
