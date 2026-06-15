'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

export interface MeResponse {
  id: string;
  walletAddress: string;
  username: string | null;
  avatarUrl: string | null;
  email: string | null;
  connections: { google: string | null; telegram: string | null; discord: string | null };
  prefs: { emailWins: boolean; marketing: boolean };
  role: 'user' | 'moderator' | 'admin';
  refCode: string;
  referredBy: string | null;
  banned: boolean;
  createdAt: string;
  /** 18+ age-gate acknowledgement timestamp; null = not yet confirmed (#44). */
  ageConfirmedAt: string | null;
  /** Last accepted legal version + when; null = never accepted (#48). */
  acceptedLegalVersion: string | null;
  acceptedLegalAt: string | null;
  /** Responsible-gambling controls (#46). */
  responsibleGambling: {
    selfExcludedUntil: string | null;
    coolOffUntil: string | null;
    dailyDepositLimitLamports: string | null;
    dailyLossLimitLamports: string | null;
    dailyWagerLimitLamports: string | null;
  };
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

export type BetGameType = 'crash' | 'coinflip' | 'blackjack' | 'lottery' | 'jackpot';

export interface BetSeed {
  clientSeed: string;
  serverSeed: string | null;
  serverSeedHash: string;
}

export interface BetRow {
  id: string;
  gameType: BetGameType;
  amountLamports: string;
  payoutLamports: string;
  multiplier: number | null;
  status: 'pending' | 'won' | 'lost' | 'refunded';
  txSignature: string | null;
  createdAt: string;
  resultJson: unknown;
  nonce: number | null;
  seed: BetSeed | null;
}

export interface BetListResponse {
  items: BetRow[];
  nextCursor: string | null;
}

export type StatsWindow = 'all' | '24h' | '7d' | '1m';

export interface StatsResponse {
  window: StatsWindow;
  totalWageredLamports: string;
  netLamports: string;
  biggestWinLamports: string;
  gamesPlayed: number;
}

export function useMe() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['me'],
    enabled: !!token,
    queryFn: () => api<MeResponse>('/me', { token }),
  });
}

/** Cursor-paginated bet history; pass a gameType to filter to one game. */
export function useMyBets(gameType?: BetGameType, limit = 20) {
  const token = useAuthStore((s) => s.accessToken);
  return useInfiniteQuery({
    queryKey: ['me', 'bets', gameType ?? 'all', limit],
    enabled: !!token,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (gameType) qs.set('gameType', gameType);
      if (pageParam) qs.set('cursor', pageParam);
      return api<BetListResponse>(`/me/bets?${qs.toString()}`, { token });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useMyStats(window: StatsWindow = 'all') {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['me', 'stats', window],
    enabled: !!token,
    queryFn: () => api<StatsResponse>(`/me/stats?window=${window}`, { token }),
  });
}

export function useResetStats() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/me/stats/reset', { method: 'POST', token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me', 'stats'] }),
  });
}

/** Stamp the 18+ acknowledgement server-side (idempotent) for an authed user. */
export function useAckAge() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<MeResponse>('/me/age-ack', { method: 'POST', token }),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  });
}

/** Record acceptance of the current legal version server-side (#48). */
export function useAcceptLegal() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<MeResponse>('/me/accept-legal', { method: 'POST', token }),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  });
}

export type SocialProvider = 'google' | 'telegram' | 'discord';

export interface ProfilePatch {
  username?: string;
  email?: string;
  avatarUrl?: string;
  notifyEmailWins?: boolean;
  notifyMarketing?: boolean;
}

export function useUpdateProfile() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) =>
      api<MeResponse>('/me', { method: 'PATCH', body: patch, token }),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  });
}

export function useUpdateConnection() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { provider: SocialProvider; account: string | null }) =>
      api<MeResponse>('/me/connection', { method: 'PUT', body: vars, token }),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  });
}
