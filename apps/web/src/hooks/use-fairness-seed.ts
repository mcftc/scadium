'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

/** Mirror of the API's ActivePairView — the unrevealed serverSeed is NEVER sent. */
export interface ActivePair {
  serverSeedHash: string;
  nextServerSeedHash: string;
  clientSeed: string;
  nonce: string; // BigInt serialized
}

export interface RotateResult {
  revealedServerSeed: string;
  serverSeedHash: string;
  nextServerSeedHash: string;
}

export function useMySeed() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['fairness', 'seed'],
    enabled: !!token,
    queryFn: () => api<ActivePair>('/fairness/seed', { token }),
  });
}

export function useSetClientSeed() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientSeed: string) =>
      api<ActivePair>('/fairness/seed/client', { method: 'POST', body: { clientSeed }, token }),
    onSuccess: (pair) => qc.setQueryData(['fairness', 'seed'], pair),
  });
}

export function useRotateServerSeed() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<RotateResult>('/fairness/seed/rotate', { method: 'POST', token }),
    // Rotation changes the active pair AND resets the nonce — refetch the view.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fairness', 'seed'] }),
  });
}
