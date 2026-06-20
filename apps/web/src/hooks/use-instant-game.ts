'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import type { MeResponse } from '@/hooks/use-me';

/**
 * Server-authoritative result for the instant, house-banked single-player games
 * (dice, limbo, plinko, wheel). Mirrors the API's `InstantSettleResult`.
 */
export interface InstantSettleResult {
  betId: string;
  gameType: string;
  amountLamports: string;
  payoutLamports: string;
  multiplier: number;
  won: boolean;
  balanceLamports: string;
  result: Record<string, unknown>;
  fairness: { serverSeedHash: string; clientSeed: string; nonce: number };
}

/**
 * Shared mutation for the instant games. POSTs `/{game}/play`, then folds the
 * server's authoritative `balanceLamports` straight into the cached `me` query
 * (never computed client-side) and invalidates so derived views refetch.
 */
export function useInstantGame<TBody extends Record<string, unknown>>(game: string) {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) =>
      api<InstantSettleResult>(`/${game}/play`, { method: 'POST', token, body }),
    onSuccess: (res) => {
      qc.setQueryData<MeResponse>(['me'], (prev) =>
        prev ? { ...prev, playBalanceLamports: res.balanceLamports } : prev,
      );
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/** Build a deep link into the /fairness verifier, mirroring crash-fairness. */
export function fairnessHref(
  game: string,
  fairness: { serverSeedHash: string; clientSeed: string; nonce: number },
): string {
  return (
    `/fairness?game=${game}` +
    `&clientSeed=${encodeURIComponent(fairness.clientSeed)}` +
    `&nonce=${fairness.nonce}` +
    `&commit=${fairness.serverSeedHash}`
  );
}
