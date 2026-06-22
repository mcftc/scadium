'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import type { MeResponse } from '@/hooks/use-me';
import type { HiloDirection } from '@scadium/shared';

export interface RoundFairness {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/** Masked in-progress Hi-Lo round (the rest of the sequence is withheld). */
export interface HiloRoundView {
  roundId: string;
  gameType: string;
  status: 'active' | 'won' | 'lost';
  stakeLamports: string;
  multiplier: number;
  state: { index: number; card: number; rank: number; steps: number; cumMult: number; maxSteps: number };
  fairness: RoundFairness;
}

/** Terminal settle (cashout / bust / reached-end). */
export interface HiloSettleResult {
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
    sequence: number[];
    index: number;
    steps?: number;
    nextCard?: number;
    direction?: HiloDirection;
    reachedEnd?: boolean;
    cashedOut?: boolean;
    busted?: boolean;
  };
  fairness: RoundFairness;
}

export type HiloResponse = HiloRoundView | HiloSettleResult;

export function isHiloSettled(r: HiloResponse): r is HiloSettleResult {
  return 'betId' in r;
}

/** Client for the stateful Hi-Lo round API (mirrors useMines/useTower). */
export function useHilo() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();

  const settleSync = (res: HiloResponse) => {
    if (isHiloSettled(res)) {
      qc.setQueryData<MeResponse>(['me'], (prev) =>
        prev ? { ...prev, playBalanceLamports: res.balanceLamports } : prev,
      );
    }
    void qc.invalidateQueries({ queryKey: ['me'] });
  };

  const start = useMutation({
    mutationFn: (body: { amountLamports: string }) =>
      api<HiloRoundView>('/hilo/start', { method: 'POST', token, body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const guess = useMutation({
    mutationFn: ({ roundId, direction }: { roundId: string; direction: HiloDirection }) =>
      api<HiloResponse>(`/hilo/${roundId}/guess`, { method: 'POST', token, body: { direction } }),
    onSuccess: settleSync,
  });

  const cashout = useMutation({
    mutationFn: ({ roundId }: { roundId: string }) =>
      api<HiloSettleResult>(`/hilo/${roundId}/cashout`, { method: 'POST', token }),
    onSuccess: settleSync,
  });

  return { start, guess, cashout };
}
