'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import type { MeResponse } from '@/hooks/use-me';

export type RgState = MeResponse['responsibleGambling'];

export interface RgLimitsInput {
  /** Lamports as a string, `null` to clear, or omit to leave unchanged. */
  dailyDepositLamports?: string | null;
  dailyLossLamports?: string | null;
  dailyWagerLamports?: string | null;
}

/** Set/clear daily deposit/loss/wager limits (#46). */
export function useSetRgLimits() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RgLimitsInput) =>
      api<RgState>('/me/responsible-gambling/limits', { method: 'PATCH', body, token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

/** Start a cooling-off period (hours) — cannot be shortened (#46). */
export function useCoolOff() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hours: number) =>
      api<RgState>('/me/responsible-gambling/cool-off', { method: 'POST', body: { hours }, token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

/** Self-exclude for a number of days — cannot be shortened, blocks login (#46). */
export function useSelfExclude() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number) =>
      api<RgState>('/me/responsible-gambling/self-exclude', {
        method: 'POST',
        body: { days },
        token,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
}
