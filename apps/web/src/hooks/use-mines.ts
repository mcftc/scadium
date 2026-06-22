'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import type { MeResponse } from '@/hooks/use-me';

export interface RoundFairness {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/** Masked in-progress round (server withholds the mine field until it ends). */
export interface MinesRoundView {
  roundId: string;
  gameType: string;
  status: 'active' | 'won' | 'lost';
  stakeLamports: string;
  multiplier: number;
  state: { mineCount: number; cells: number; revealed: number[] };
  fairness: RoundFairness;
}

/** Terminal settle (cashout / bust / full clear). */
export interface MinesSettleResult {
  roundId: string;
  betId: string;
  gameType: string;
  status: 'won' | 'lost';
  stakeLamports: string;
  payoutLamports: string;
  multiplier: number;
  won: boolean;
  balanceLamports: string;
  result: { mines: number[]; mineCount: number; revealed: number[]; hitMine?: number };
  fairness: RoundFairness;
}

export type MinesResponse = MinesRoundView | MinesSettleResult;

export function isMinesSettled(r: MinesResponse): r is MinesSettleResult {
  return 'betId' in r;
}

/**
 * Client for the stateful Mines round API. `start` debits the stake (so we
 * refetch `me`); `pick`/`cashout` may return either an updated masked view or a
 * terminal settle — on settle we fold the server's authoritative balance into
 * the cached `me` query, never computing it client-side.
 */
export function useMines() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();

  const settleSync = (res: MinesResponse) => {
    if (isMinesSettled(res)) {
      qc.setQueryData<MeResponse>(['me'], (prev) =>
        prev ? { ...prev, playBalanceLamports: res.balanceLamports } : prev,
      );
      void qc.invalidateQueries({ queryKey: ['bets'] });
    }
    void qc.invalidateQueries({ queryKey: ['me'] });
  };

  const start = useMutation({
    mutationFn: (body: { amountLamports: string; mines: number }) =>
      api<MinesRoundView>('/mines/start', { method: 'POST', token, body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const pick = useMutation({
    mutationFn: ({ roundId, cell }: { roundId: string; cell: number }) =>
      api<MinesResponse>(`/mines/${roundId}/pick`, { method: 'POST', token, body: { cell } }),
    onSuccess: settleSync,
  });

  const cashout = useMutation({
    mutationFn: ({ roundId }: { roundId: string }) =>
      api<MinesSettleResult>(`/mines/${roundId}/cashout`, { method: 'POST', token }),
    onSuccess: settleSync,
  });

  return { start, pick, cashout };
}
