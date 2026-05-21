'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import type { Card } from '@scadium/shared';

export interface BlackjackState {
  betLamports: string;
  phase: 'player' | 'dealer' | 'settled';
  playerCards: Card[];
  playerTotal: number;
  playerStatus: 'playing' | 'standing' | 'busted' | 'blackjack';
  playerBet: string;
  doubled: boolean;
  dealerCards: (Card | null)[];
  dealerTotal: number | null;
  result: 'win' | 'lose' | 'push' | 'blackjack' | null;
  payoutLamports: string | null;
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeed: string;
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
}

export function useBlackjackActive() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['blackjack', 'active'],
    enabled: !!token,
    queryFn: () => api<BlackjackState | null>('/blackjack/active', { token }),
    refetchOnMount: 'always',
  });
}

export function useStartBlackjack() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountLamports: string) =>
      api<BlackjackState>('/blackjack/start', {
        method: 'POST',
        body: { amountLamports },
        token,
      }),
    onSuccess: (data) => qc.setQueryData(['blackjack', 'active'], data),
  });
}

export function useBlackjackAction() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'hit' | 'stand' | 'double') =>
      api<BlackjackState>('/blackjack/action', {
        method: 'POST',
        body: { action },
        token,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['blackjack', 'active'], data);
      if (data.phase === 'settled') qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
