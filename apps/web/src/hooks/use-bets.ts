'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import type { BetGameType, BetListResponse } from '@/hooks/use-me';

/**
 * The current user's recent bets for one game (newest first). Powers the
 * per-game "Recent rounds" panel. Disabled when logged out; invalidate
 * `['bets', game]` after a settle to refresh.
 */
export function useBets(game: BetGameType, limit = 8) {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['bets', game, limit],
    enabled: !!token,
    queryFn: () =>
      api<BetListResponse>(`/users/bets?gameType=${game}&limit=${limit}`, { token }),
  });
}
