'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, postOnce } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useSocket } from '@/providers/socket-provider';
import type { MeResponse } from '@/hooks/use-me';

/**
 * Per-game resolved listeners (spectate modal). Module-level registry so the
 * single lobby socket handler can fan events out to whichever modal is open.
 */
const resolvedListeners = new Map<string, Set<(game: CoinflipGame) => void>>();
const cancelledListeners = new Map<string, Set<() => void>>();
/** The signed-in creator's flip was taken by another player (lobby auto-opens it). */
const myFlipJoinedListeners = new Set<(game: CoinflipGame) => void>();

/** Fan a resolution out to any modal watching it — from the socket OR an HTTP response. */
function notifyResolved(game: CoinflipGame) {
  resolvedListeners.get(game.id)?.forEach((cb) => cb(game));
}

export function subscribeMyFlipJoined(cb: (game: CoinflipGame) => void): () => void {
  myFlipJoinedListeners.add(cb);
  return () => {
    myFlipJoinedListeners.delete(cb);
  };
}

export function subscribeFlipResolved(
  gameId: string,
  cb: (game: CoinflipGame) => void,
): () => void {
  const set = resolvedListeners.get(gameId) ?? new Set();
  set.add(cb);
  resolvedListeners.set(gameId, set);
  return () => {
    set.delete(cb);
    if (set.size === 0) resolvedListeners.delete(gameId);
  };
}

/** Notifies an open spectate modal that its watched flip was cancelled. */
export function subscribeFlipCancelled(gameId: string, cb: () => void): () => void {
  const set = cancelledListeners.get(gameId) ?? new Set();
  set.add(cb);
  cancelledListeners.set(gameId, set);
  return () => {
    set.delete(cb);
    if (set.size === 0) cancelledListeners.delete(gameId);
  };
}

export interface CoinflipGame {
  id: string;
  creatorId: string;
  creatorUsername: string | null;
  creatorWallet: string | null;
  creatorSide: 'heads' | 'tails';
  /** The creator played deposited SOL (custody): only deposited accounts may join. */
  creatorFunded: boolean;
  joinerId: string | null;
  joinerUsername: string | null;
  joinerWallet: string | null;
  /** Resolved against the house (no joiner; winnerId null when the house won). */
  vsHouse: boolean;
  amountLamports: string;
  result: 'heads' | 'tails' | null;
  winnerId: string | null;
  status: 'open' | 'matched' | 'resolving' | 'completed' | 'cancelled';
  createdAt: string;
  resolvedAt: string | null;
  /** When an unjoined PvP flip is cancelled + refunded; null once resolved. */
  expiresAt: string | null;
  serverSeedHash: string | null;
  serverSeed: string | null;
  clientSeed: string | null;
  nonce: number | null;
}

/**
 * Realtime-backed hook for the open-flip lobby. Seeds from the REST list
 * endpoint, then patches the cache on every `flip:created` /
 * `flip:resolved` / `flip:cancelled` socket event so the UI never needs a
 * refetch during the session.
 */
export type FlipSortKey = 'newest' | 'amount';

export function useOpenCoinflips(sort: FlipSortKey = 'newest') {
  const qc = useQueryClient();
  const socket = useSocket('/coinflip');

  const query = useQuery({
    queryKey: ['coinflip', 'open', sort],
    // Sorted by the server: sorting only the newest page client-side made
    // "Highest Price" the highest of whatever 20 happened to arrive.
    queryFn: () => api<CoinflipGame[]>(`/coinflip/open?sort=${sort}`),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!socket) return;
    const myId = () => qc.getQueryData<MeResponse>(['me'])?.id;
    const onCreated = (game: CoinflipGame) => {
      qc.setQueriesData<CoinflipGame[]>({ queryKey: ['coinflip', 'open'] }, (prev) => {
        if (!prev) return [game];
        if (prev.some((g) => g.id === game.id)) return prev;
        return [game, ...prev];
      });
      if (game.creatorId === myId()) qc.invalidateQueries({ queryKey: ['coinflip', 'mine'] });
    };
    const onResolved = (game: CoinflipGame) => {
      qc.setQueriesData<CoinflipGame[]>({ queryKey: ['coinflip', 'open'] }, (prev) =>
        prev ? prev.filter((g) => g.id !== game.id) : prev,
      );
      qc.setQueryData<CoinflipGame[]>(['coinflip', 'recent'], (prev) => {
        if (!prev) return [game];
        return [game, ...prev].slice(0, 20);
      });
      // Balance + bet history changed only for the two players in it — every
      // other viewer refetching /me on every flip was N requests per flip.
      const me = myId();
      if (me && (game.creatorId === me || game.joinerId === me)) {
        qc.invalidateQueries({ queryKey: ['me'] });
        qc.invalidateQueries({ queryKey: ['coinflip', 'mine'] });
      }
      // Notify any open spectate modal watching this game.
      notifyResolved(game);
      // A creator who wasn't watching still gets their moment: someone took
      // their flip (house flips are the creator's own action, already on screen).
      if (me && game.creatorId === me && !game.vsHouse) {
        myFlipJoinedListeners.forEach((cb) => cb(game));
      }
    };
    const onCancelled = ({ id }: { id: string }) => {
      qc.setQueriesData<CoinflipGame[]>({ queryKey: ['coinflip', 'open'] }, (prev) =>
        prev ? prev.filter((g) => g.id !== id) : prev,
      );
      qc.invalidateQueries({ queryKey: ['coinflip', 'mine'] });
      // A modal watching this flip must not sit on "Waiting for player…" forever.
      cancelledListeners.get(id)?.forEach((cb) => cb());
    };

    // Events missed while disconnected (every server restart) left the lobby
    // listing flips that were gone and missing new ones — re-read it on reconnect.
    const onConnect = () => {
      qc.invalidateQueries({ queryKey: ['coinflip'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    };

    socket.on('connect', onConnect);
    socket.on('flip:created', onCreated);
    socket.on('flip:resolved', onResolved);
    socket.on('flip:cancelled', onCancelled);
    return () => {
      socket.off('connect', onConnect);
      socket.off('flip:created', onCreated);
      socket.off('flip:resolved', onResolved);
      socket.off('flip:cancelled', onCancelled);
    };
  }, [socket, qc]);

  return query;
}

export function useRecentCoinflips() {
  return useQuery({
    queryKey: ['coinflip', 'recent'],
    queryFn: () => api<CoinflipGame[]>('/coinflip/recent'),
    staleTime: 10_000,
  });
}

/** The signed-in player's open flips — their locked stakes, whatever the lobby shows. */
export function useMyCoinflips() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['coinflip', 'mine'],
    enabled: !!token,
    queryFn: () => api<CoinflipGame[]>('/coinflip/mine', { token }),
    staleTime: 10_000,
  });
}

export function useCreateCoinflip() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { side: 'heads' | 'tails'; amountLamports: string; vsHouse?: boolean }) =>
      postOnce<CoinflipGame>('/coinflip', params, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['coinflip', 'mine'] });
    },
  });
}

export function useJoinCoinflip() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) => postOnce<CoinflipGame>(`/coinflip/${gameId}/join`, {}, token),
    onSuccess: (game) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      // The joiner's own result comes from THIS response, not the socket: with
      // the socket down they used to sit on "Waiting for player…" after playing.
      notifyResolved(game);
    },
  });
}

/** Send your own open flip to the house (creator only). */
export function usePlayHouse() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) =>
      api<CoinflipGame>(`/coinflip/${gameId}/house`, { method: 'POST', token }),
    onSuccess: (game) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['coinflip', 'mine'] });
      notifyResolved(game);
    },
  });
}

export function useCancelCoinflip() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) =>
      api<CoinflipGame>(`/coinflip/${gameId}/cancel`, {
        method: 'POST',
        token,
      }),
    // The stake refund lands on the play balance.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['coinflip', 'mine'] });
    },
  });
}
