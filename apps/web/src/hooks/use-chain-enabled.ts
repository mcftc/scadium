'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

interface ChainConfig {
  enabled: boolean;
  programId?: string | null;
  scadMint?: string | null;
}

/**
 * Single source of truth for whether on-chain settlement is genuinely live.
 * Reads `GET /vault/config` (backed by `ChainService.enabled`, default false in
 * play-money mode). Defaults to `false` while loading or on error so the UI
 * never asserts an on-chain settlement claim it cannot back up (#42).
 */
export function useChainEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['vault', 'config'],
    queryFn: () => api<ChainConfig>('/vault/config'),
    staleTime: 60_000,
    retry: false, // a degraded config endpoint should settle to play-money copy promptly
  });
  return data?.enabled ?? false;
}
