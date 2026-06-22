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

/** Masked in-progress Tower round (trap layout withheld until it ends). */
export interface TowerRoundView {
  roundId: string;
  gameType: string;
  status: 'active' | 'won' | 'lost';
  stakeLamports: string;
  multiplier: number;
  state: { rows: number; columns: number; safePerRow: number; currentRow: number; picks: number[] };
  fairness: RoundFairness;
}

/** Terminal settle (cashout / bust / reached-top). */
export interface TowerSettleResult {
  roundId: string;
  betId: string;
  gameType: string;
  status: 'won' | 'lost';
  stakeLamports: string;
  payoutLamports: string;
  multiplier: number;
  won: boolean;
  balanceLamports: string;
  result: {
    traps: number[][];
    picks: number[];
    climbed?: number;
    hitRow?: number;
    hitColumn?: number;
    reachedTop?: boolean;
  };
  fairness: RoundFairness;
}

export type TowerResponse = TowerRoundView | TowerSettleResult;

export function isTowerSettled(r: TowerResponse): r is TowerSettleResult {
  return 'betId' in r;
}

/** Client for the stateful Tower round API (mirrors useMines). */
export function useTower() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();

  const settleSync = (res: TowerResponse) => {
    if (isTowerSettled(res)) {
      qc.setQueryData<MeResponse>(['me'], (prev) =>
        prev ? { ...prev, playBalanceLamports: res.balanceLamports } : prev,
      );
    }
    void qc.invalidateQueries({ queryKey: ['me'] });
  };

  const start = useMutation({
    mutationFn: (body: { amountLamports: string }) =>
      api<TowerRoundView>('/tower/start', { method: 'POST', token, body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const pick = useMutation({
    mutationFn: ({ roundId, column }: { roundId: string; column: number }) =>
      api<TowerResponse>(`/tower/${roundId}/pick`, { method: 'POST', token, body: { column } }),
    onSuccess: settleSync,
  });

  const cashout = useMutation({
    mutationFn: ({ roundId }: { roundId: string }) =>
      api<TowerSettleResult>(`/tower/${roundId}/cashout`, { method: 'POST', token }),
    onSuccess: settleSync,
  });

  return { start, pick, cashout };
}
