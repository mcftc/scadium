'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

/** Public platform status — drives the maintenance banner / disabled play (#56). */
export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => api<{ paused: boolean }>('/status'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
