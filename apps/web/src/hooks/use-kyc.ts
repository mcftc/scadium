'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

/** Begin identity verification — returns the provider SDK token (#45). */
export function useStartKyc() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ token: string; providerRef: string; status: string }>('/kyc/start', {
        method: 'POST',
        token,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
}
