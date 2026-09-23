'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useSocket } from '@/providers/socket-provider';
import { useLiveSnapshot } from '@/hooks/use-live-snapshot';

export interface JackpotPlayer {
  /** Opaque public id (compare with `me.publicId`) — never the userId. */
  playerId: string;
  /** Display handle: username, or a shortened wallet. */
  player: string;
  amountLamports: string;
  chance: number; // 0..1 share of the pot
}

/** One entry's ticket range [start, end) in a settled round, in entry order. */
export interface JackpotRange {
  playerId: string;
  player: string;
  amountLamports: string;
  start: string;
  end: string;
}

/** The `jackpot:result` broadcast. */
export interface JackpotResultEvent {
  roundId: string;
  status: 'drawn' | 'refunded';
  winnerPlayerId: string | null;
  winnerName: string | null;
  payoutLamports: string;
  totalLamports: string;
  winningTicket: string | null;
  serverSeed: string;
  ranges: JackpotRange[];
}

export interface JackpotResult {
  roundId: string;
  status: 'drawn' | 'refunded';
  winnerName: string | null;
  payoutLamports: string;
  totalLamports: string;
  winningTicket: string | null;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  drawnAt: number;
  /** drand round the ticket folded in (ADR 0004). */
  beaconRound: number | null;
}

export interface JackpotSnapshot {
  roundId: string;
  status: 'open' | 'drawn' | 'refunded';
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  /**
   * When entries close. Null while the round waits for its first player; with
   * one player it is the solo deadline (refund if nobody joins), from the
   * `minPlayers`-th player on it is the draw countdown.
   */
  closeAt: number | null;
  /** The drand round the draw WILL fold in, once the countdown runs (ADR 0004). */
  beaconRound: number | null;
  totalLamports: string;
  playerCount: number;
  config: {
    minEntryLamports: string;
    maxEntryLamports: string;
    houseEdge: number;
    minPlayers: number;
    roundWindowMs: number;
    soloWaitMs: number;
  };
  lastResult: JackpotResult | null;
  players: JackpotPlayer[];
}

export interface MyJackpotRow {
  roundId: string;
  status: 'open' | 'drawn' | 'refunded';
  myAmountLamports: string;
  totalLamports: string;
  won: boolean;
  payoutLamports: string;
  createdAt: string;
}

export interface JackpotRoundRow {
  id: string;
  status: 'drawn' | 'refunded';
  totalLamports: string;
  payoutLamports: string;
  winningTicket: string | null;
  winnerName: string | null;
  winnerPlayerId: string | null;
  drawnAt: string | null;
  ranges: JackpotRange[];
  /** drand round the ticket folded in, and its value (ADR 0004). */
  beaconRound: string | null;
  entropy: string | null;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/** Entry broadcast — enough to update the pot without asking the server again. */
interface JackpotEntryEvent {
  roundId: string;
  playerId: string;
  player: string;
  amountLamports: string;
  totalLamports: string;
  playerCount: number;
  closeAt: number | null;
}

/** Merge one entry into the snapshot and recompute every player's chance locally. */
function applyEntry(s: JackpotSnapshot, p: JackpotEntryEvent): JackpotSnapshot {
  const players = s.players.some((pl) => pl.playerId === p.playerId)
    ? s.players.map((pl) =>
        pl.playerId === p.playerId
          ? {
              ...pl,
              amountLamports: (BigInt(pl.amountLamports) + BigInt(p.amountLamports)).toString(),
            }
          : pl,
      )
    : [
        ...s.players,
        {
          playerId: p.playerId,
          player: p.player,
          amountLamports: p.amountLamports,
          chance: 0,
        },
      ];
  const total = BigInt(p.totalLamports);
  return {
    ...s,
    totalLamports: p.totalLamports,
    playerCount: p.playerCount,
    closeAt: p.closeAt,
    players: players
      .map((pl) => ({
        ...pl,
        chance:
          total > BigInt(0) ? Number((Number(pl.amountLamports) / Number(total)).toFixed(4)) : 0,
      }))
      .sort((a, b) => Number(b.amountLamports) - Number(a.amountLamports)),
  };
}

export function useJackpot() {
  const { snap, setSnap, refetch } = useLiveSnapshot<JackpotSnapshot>('/jackpot/current');
  const socket = useSocket('/jackpot');
  const qc = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => {
      // A reconnect usually means the server restarted: re-read the round, and
      // anything a settle we missed may have changed.
      refetch();
      qc.invalidateQueries({ queryKey: ['jackpot'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    };
    const onRoundOpen = () => refetch();
    const onEntry = (p: JackpotEntryEvent) =>
      setSnap((s) => (s && s.roundId === p.roundId ? applyEntry(s, p) : s));
    const onResult = () => {
      refetch();
      qc.invalidateQueries({ queryKey: ['jackpot', 'mine'] });
      qc.invalidateQueries({ queryKey: ['jackpot', 'recent'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    };
    socket.on('connect', onConnect);
    socket.on('jackpot:round-open', onRoundOpen);
    socket.on('jackpot:entry', onEntry);
    socket.on('jackpot:result', onResult);
    return () => {
      socket.off('connect', onConnect);
      socket.off('jackpot:round-open', onRoundOpen);
      socket.off('jackpot:entry', onEntry);
      socket.off('jackpot:result', onResult);
    };
  }, [socket, qc, refetch, setSnap]);

  return snap;
}

export function useEnterJackpot() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountLamports: string) =>
      api('/jackpot/enter', { method: 'POST', body: { amountLamports }, token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['jackpot', 'mine'] });
    },
  });
}

export function useMyJackpot() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['jackpot', 'mine'],
    enabled: !!token,
    queryFn: () => api<MyJackpotRow[]>('/jackpot/my-entries', { token }),
  });
}

export function useJackpotRecent() {
  return useQuery({
    queryKey: ['jackpot', 'recent'],
    queryFn: () => api<JackpotRoundRow[]>('/jackpot/recent'),
    staleTime: 15_000,
  });
}
