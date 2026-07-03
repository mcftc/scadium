'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
      void qc.invalidateQueries({ queryKey: ['bets'] });
      qc.setQueryData(['tower', 'active'], null);
    } else {
      qc.setQueryData(['tower', 'active'], res);
    }
    void qc.invalidateQueries({ queryKey: ['me'] });
  };

  // Server-side resume: the stake is debited at start, so a reload mid-round
  // must rehydrate the open round (otherwise every new start 409s forever).
  const active = useQuery({
    queryKey: ['tower', 'active'],
    // Nest serializes a null body as empty text and api() maps that to
    // undefined — coerce so TanStack Query sees an explicit null.
    queryFn: async () => (await api<TowerRoundView | null>('/tower/active', { token })) ?? null,
    enabled: !!token,
    staleTime: 5_000,
  });

  const start = useMutation({
    mutationFn: (body: { amountLamports: string }) =>
      api<TowerRoundView>('/tower/start', { method: 'POST', token, body }),
    onSuccess: (res) => {
      qc.setQueryData(['tower', 'active'], res);
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
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

  /** Drop the cached active round (used to self-heal a stale/phantom round). */
  const resetActive = () => qc.setQueryData(['tower', 'active'], null);

  return { start, pick, cashout, active, resetActive };
}
