'use client';

import { useEffect, useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Card } from '@scadium/shared';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useSocket } from '@/providers/socket-provider';

export type TablePhase =
  | 'idle'
  | 'betting'
  | 'dealing'
  | 'player_turns'
  | 'dealer_turn'
  | 'settled';

export interface TableSeat {
  index: number;
  userId: string;
  username: string | null;
  walletAddress: string;
  bet: {
    mainLamports: string;
    side21p3Lamports: string;
    sidePerfectPairsLamports: string;
  } | null;
  cards: Card[];
  total: number | null;
  status: 'playing' | 'standing' | 'busted' | 'blackjack';
  doubled: boolean;
  side21p3Outcome: string | null;
  sidePerfectPairsOutcome: string | null;
  result: 'win' | 'lose' | 'push' | 'blackjack' | null;
  payoutLamports: string;
}

export interface BlackjackTableSnapshot {
  id: string;
  name: string;
  isPrivate: boolean;
  phase: TablePhase;
  closeAt: number | null;
  activeSeat: number | null;
  maxSeats: number;
  seats: TableSeat[];
  dealerCards: (Card | null)[];
  dealerTotal: number | null;
  serverSeedHash: string | null;
  serverSeed: string | null;
  clientSeed: string | null;
  nonce: number;
  config: {
    minBetLamports: string;
    maxBetLamports: string;
    bettingWindowMs: number;
    turnTimeoutMs: number;
    sideBets: {
      twentyOnePlusThree: Record<string, number>;
      perfectPairs: Record<string, number>;
    };
  };
}

export interface TableListRow {
  id: string;
  name: string;
  phase: TablePhase;
  seatedCount: number;
  maxSeats: number;
}

export function useBlackjackTables() {
  return useQuery({
    queryKey: ['blackjack', 'tables'],
    queryFn: () => api<TableListRow[]>('/blackjack/tables'),
    staleTime: 10_000,
  });
}

/**
 * Live table state: REST seed + `/blackjack` socket. `bj:table` snapshots
 * rebuild the whole state (resilient to missed packets); `bj:card` events
 * are surfaced via `lastCard` so the UI can stagger deal animations.
 */
export function useBlackjackTable(tableId: string | null) {
  const [snapshot, setSnapshot] = useState<BlackjackTableSnapshot | null>(null);
  // Reset the snapshot during render when the table changes, rather than via a
  // setState-in-effect — avoids briefly showing the previous table's state.
  const [prevTableId, setPrevTableId] = useState(tableId);
  if (prevTableId !== tableId) {
    setPrevTableId(tableId);
    setSnapshot(null);
  }
  const [lastCard, setLastCard] = useState<{
    seatIndex: number | 'dealer';
    card: Card | null;
    at: number;
  } | null>(null);
  const socket = useSocket('/blackjack');
  const qc = useQueryClient();

  const refetch = useCallback(() => {
    if (!tableId) return;
    api<BlackjackTableSnapshot>(`/blackjack/tables/${tableId}`)
      .then(setSnapshot)
      .catch(() => {});
  }, [tableId]);

  useEffect(() => {
    refetch();
    // Light polling fallback — covers socket events that raced the initial
    // namespace connect (e.g. seating yourself right after page load).
    const id = setInterval(refetch, 5_000);
    return () => clearInterval(id);
  }, [tableId, refetch]);

  useEffect(() => {
    if (!socket || !tableId) return;
    const onTable = (p: { tableId: string; snapshot: BlackjackTableSnapshot }) => {
      if (p.tableId !== tableId) return;
      setSnapshot(p.snapshot);
      if (p.snapshot.phase === 'settled') {
        qc.invalidateQueries({ queryKey: ['me'] });
      }
    };
    const onCard = (p: { tableId: string; seatIndex: number | 'dealer'; card: Card | null }) => {
      if (p.tableId !== tableId) return;
      setLastCard({ seatIndex: p.seatIndex, card: p.card, at: Date.now() });
    };
    socket.on('bj:table', onTable);
    socket.on('bj:card', onCard);
    return () => {
      socket.off('bj:table', onTable);
      socket.off('bj:card', onCard);
    };
  }, [socket, tableId, qc]);

  return { snapshot, lastCard, refetch };
}

export function useBlackjackActions(tableId: string | null) {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['me'] });
  }, [qc]);

  const seat = useMutation({
    mutationFn: (seatIndex: number) =>
      api(`/blackjack/tables/${tableId}/seat`, { method: 'POST', body: { seatIndex }, token }),
  });
  const leave = useMutation({
    mutationFn: () => api(`/blackjack/tables/${tableId}/leave`, { method: 'POST', token }),
    onSuccess: invalidate,
  });
  const bet = useMutation({
    mutationFn: (params: {
      mainLamports: string;
      side21p3Lamports?: string;
      sidePerfectPairsLamports?: string;
    }) => api(`/blackjack/tables/${tableId}/bet`, { method: 'POST', body: params, token }),
    onSuccess: invalidate,
  });
  const clearBet = useMutation({
    mutationFn: () => api(`/blackjack/tables/${tableId}/clear-bet`, { method: 'POST', token }),
    onSuccess: invalidate,
  });
  const action = useMutation({
    mutationFn: (a: 'hit' | 'stand' | 'double') =>
      api(`/blackjack/tables/${tableId}/action`, { method: 'POST', body: { action: a }, token }),
    onSuccess: invalidate,
  });
  const findLobby = useMutation({
    mutationFn: () => api<{ tableId: string }>('/blackjack/lobby/find', { method: 'POST', token }),
  });
  const solo = useMutation({
    mutationFn: () => api<{ tableId: string }>('/blackjack/solo', { method: 'POST', token }),
  });

  return { seat, leave, bet, clearBet, action, findLobby, solo };
}
