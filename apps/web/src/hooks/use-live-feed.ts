'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useSocket } from '@/providers/socket-provider';

/** A single settled bet in the sitewide feed (mirrors the API's `LiveBetEvent`). */
export interface LiveBet {
  id: string;
  gameType: string;
  player: string;
  avatarUrl: string | null;
  amountLamports: string;
  payoutLamports: string;
  multiplier: number | null;
  won: boolean;
  at: number;
}

const MAX = 24;

/**
 * Sitewide live-bet feed (#roadmap-4). Seeds the initial list from
 * `GET /live/bets` (durable, DB-backed) then prepends `live:bet` events from the
 * `/live` socket — the same seed-from-REST-then-patch pattern as `useAirdropPool`.
 * Deduped by bet id so a race between the seed and an early socket event can't
 * double-insert.
 */
export function useLiveFeed(limit = MAX) {
  const [bets, setBets] = useState<LiveBet[]>([]);
  const socket = useSocket('/live');

  useEffect(() => {
    let cancelled = false;
    api<LiveBet[]>(`/live/bets?limit=${limit}`)
      .then((seed) => {
        if (!cancelled) {
          setBets((cur) => dedupe([...cur, ...seed]).slice(0, limit));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [limit]);

  useEffect(() => {
    if (!socket) return;
    const onBet = (bet: LiveBet) => setBets((cur) => dedupe([bet, ...cur]).slice(0, limit));
    socket.on('live:bet', onBet);
    return () => {
      socket.off('live:bet', onBet);
    };
  }, [socket, limit]);

  return bets;
}

function dedupe(list: LiveBet[]): LiveBet[] {
  const seen = new Set<string>();
  const out: LiveBet[] = [];
  for (const b of list) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out;
}
