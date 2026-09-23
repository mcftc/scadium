'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { env } from '@/config/env';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

export type CrashPhase = 'waiting' | 'running' | 'busted';

export interface CrashBet {
  userId: string;
  username: string | null;
  walletAddress: string;
  amountLamports: string;
  /** The full wager (amountLamports shrinks on partial cashouts). */
  originalAmountLamports?: string;
  autoCashout: number | null;
  cashedOutAt: number | null;
  /** Accumulated (partial) cashout payouts this round. */
  payoutLamports?: string;
}

/** One cashout event, rendered as a marker pinned to the curve. */
export interface CrashCashoutMarker {
  userId: string;
  name: string;
  multiplier: number;
  payoutLamports: string;
}

export interface CrashSnapshot {
  roundId: string;
  phase: CrashPhase;
  startedAt: number | null;
  /**
   * Ms left in the betting window at the moment this state was received from the
   * server (relative, anchored to the client's own clock — skew-proof). Undefined
   * on non-waiting phases. Drives the waiting countdown so a mid-window page
   * refresh shows the true remaining time, not a fresh full 15s.
   */
  bettingMsRemaining?: number | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  serverSeed: string | null;
  bustPoint: number | null;
  multiplier: number;
  bets: CrashBet[];
  history: { bustPoint: number; roundId: string }[];
}

/** A round that ended while this client was disconnected (it never saw the bust). */
export interface CrashInterruption {
  roundId: string;
  at: number;
}

/**
 * Subscribes to the server-authoritative crash round. Seeds state from
 * the `/snapshot` REST endpoint, then tracks live updates via the
 * `/crash` Socket.io namespace.
 */
export function useCrash() {
  const [state, setState] = useState<CrashSnapshot | null>(null);
  const [cashouts, setCashouts] = useState<CrashCashoutMarker[]>([]);
  const [connected, setConnected] = useState(false);
  const [interrupted, setInterrupted] = useState<CrashInterruption | null>(null);
  const [, setTick] = useState(0);
  const queryClient = useQueryClient();
  // Bumped by every live round/phase event. A snapshot request that started
  // before the latest event is older than what we already show, so it may only
  // backfill history — overwriting with it re-created the H16 symptom (a stale
  // busted round replacing a fresh one, hiding the player's new bet).
  const eventSeq = useRef(0);
  const stateRef = useRef<CrashSnapshot | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const applySnapshot = (reason: 'mount' | 'connect') => {
      const seqAtRequest = eventSeq.current;
      const before = stateRef.current;
      api<CrashSnapshot>('/crash/snapshot')
        .then((snap) => {
          const stale = eventSeq.current !== seqAtRequest;
          setState((prev) => {
            if (!prev) return snap;
            if (stale) return prev.history?.length ? prev : { ...prev, history: snap.history };
            return { ...snap, history: snap.history?.length ? snap.history : prev.history };
          });
          // A round that was live when we lost the socket and is gone now ended
          // unseen — tell the player instead of letting their bet just vanish.
          if (
            reason === 'connect' &&
            !stale &&
            before &&
            before.roundId !== snap.roundId &&
            before.phase !== 'busted'
          ) {
            setInterrupted({ roundId: before.roundId, at: Date.now() });
          }
        })
        .catch(() => {
          /* noop */
        });
    };

    // Seed from REST — never clobbering live state a socket event already set.
    applySnapshot('mount');

    const sock = io(`${env.wsUrl.replace(/\/$/, '')}/crash`, {
      transports: ['websocket'],
      reconnection: true,
      withCredentials: true,
    });

    // On every (re)connect the REST snapshot is the authoritative current round
    // — a WS drop that spans the waiting→running transition (a restart, a
    // deploy, an edge reset) must not leave `phase` stuck at 'waiting', which
    // would disable the cash-out button on a live bet (#H16). The balance may
    // also have moved while we were away (a settle, a restart refund).
    sock.on('connect', () => {
      setConnected(true);
      applySnapshot('connect');
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['bets', 'crash'] });
    });
    // While disconnected the round on screen is frozen: the UI must not offer a
    // cash-out that can only fail.
    sock.on('disconnect', () => setConnected(false));
    sock.on('connect_error', () => setConnected(false));

    sock.on(
      'crash:round-start',
      (p: {
        roundId: string;
        serverSeedHash: string;
        clientSeed: string;
        nonce: number;
        bettingWindowMs?: number;
      }) => {
        eventSeq.current += 1;
        setState((prev) => ({
          roundId: p.roundId,
          phase: 'waiting' as const,
          startedAt: null,
          // Round just opened → the full window remains (fall back if omitted).
          bettingMsRemaining: p.bettingWindowMs ?? null,
          serverSeedHash: p.serverSeedHash,
          clientSeed: p.clientSeed,
          nonce: p.nonce,
          serverSeed: null,
          bustPoint: null,
          multiplier: 1.0,
          bets: [],
          history: prev?.history ?? [],
        }));
        setCashouts([]); // markers belong to the previous round
      },
    );

    // Events for a round other than the one on screen are ignored: after a
    // reconnect they can arrive for a round this client has not been shown yet.
    sock.on('crash:running', ({ roundId }: { roundId?: string }) => {
      eventSeq.current += 1;
      setState((s) =>
        s && (!roundId || s.roundId === roundId)
          ? { ...s, phase: 'running', startedAt: Date.now() }
          : s,
      );
    });

    sock.on('crash:tick', ({ roundId, multiplier }: { roundId?: string; multiplier: number }) => {
      setState((s) => (s && (!roundId || s.roundId === roundId) ? { ...s, multiplier } : s));
      setTick((t) => t + 1);
    });

    sock.on(
      'crash:bust',
      ({
        roundId,
        bustPoint,
        serverSeed,
      }: {
        roundId?: string;
        bustPoint: number;
        serverSeed: string;
      }) => {
        eventSeq.current += 1;
        setState((s) =>
          s && (!roundId || s.roundId === roundId)
            ? {
                ...s,
                phase: 'busted',
                bustPoint,
                multiplier: bustPoint,
                serverSeed,
                history: [{ bustPoint, roundId: s.roundId }, ...s.history].slice(0, 20),
              }
            : s,
        );
        // Round settled server-side (auto-cashout wins / losses) — refresh balance.
        void queryClient.invalidateQueries({ queryKey: ['me'] });
        void queryClient.invalidateQueries({ queryKey: ['bets', 'crash'] });
      },
    );

    sock.on('crash:bet-placed', (bet: CrashBet & { roundId: string }) => {
      setState((s) =>
        s && s.roundId === bet.roundId
          ? {
              ...s,
              bets: [
                ...s.bets.filter((b) => b.userId !== bet.userId),
                // A fresh bet's remaining stake IS its original wager.
                { ...bet, originalAmountLamports: bet.amountLamports, payoutLamports: '0' },
              ],
            }
          : s,
      );
    });

    sock.on(
      'crash:cashed-out',
      ({
        roundId,
        userId,
        username,
        walletAddress,
        multiplier,
        payoutLamports,
        remainingLamports,
      }: {
        roundId?: string;
        userId: string;
        username?: string | null;
        walletAddress?: string;
        multiplier: number;
        payoutLamports?: string;
        remainingLamports?: string;
      }) => {
        // Progressive cashouts: only mark fully-out when nothing is riding.
        const remaining = remainingLamports ?? '0';
        const payout = payoutLamports ?? '0';
        if (roundId && stateRef.current && stateRef.current.roundId !== roundId) return;
        setState((s) =>
          s
            ? {
                ...s,
                bets: s.bets.map((b) =>
                  b.userId === userId
                    ? {
                        ...b,
                        amountLamports: remaining,
                        cashedOutAt: remaining === '0' ? multiplier : b.cashedOutAt,
                        payoutLamports: (
                          BigInt(b.payoutLamports ?? '0') + BigInt(payout)
                        ).toString(),
                      }
                    : b,
                ),
              }
            : s,
        );
        // Pin a marker to the curve at the exit multiplier (cleared on round-start).
        const name = username ?? (walletAddress ? `${walletAddress.slice(0, 4)}…` : 'player');
        setCashouts((cur) =>
          [...cur, { userId, name, multiplier, payoutLamports: payout }].slice(-24),
        );
      },
    );

    return () => {
      sock.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissInterruption = useCallback(() => setInterrupted(null), []);
  return { state, cashouts, connected, interrupted, dismissInterruption };
}

export function useCrashActions() {
  const token = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const placeBet = useCallback(
    async (params: { amountLamports: string; autoCashout?: number | null }) => {
      const res = await api<{ ok: true; roundId: string }>('/crash/bet', {
        method: 'POST',
        body: {
          amountLamports: params.amountLamports,
          autoCashout: params.autoCashout ?? undefined,
        },
        token,
      });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      return res;
    },
    [token, queryClient],
  );
  const cashOut = useCallback(
    async (percent = 100) => {
      const res = await api<{
        payoutLamports: string;
        multiplier: number;
        remainingLamports: string;
      }>('/crash/cashout', {
        method: 'POST',
        body: percent < 100 ? { percent } : {},
        token,
      });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      return res;
    },
    [token, queryClient],
  );
  const scheduleBet = useCallback(
    async (params: { amountLamports: string; autoCashout?: number | null }) => {
      const res = await api<{ ok: true; scheduled: true }>('/crash/schedule', {
        method: 'POST',
        body: {
          amountLamports: params.amountLamports,
          autoCashout: params.autoCashout ?? undefined,
        },
        token,
      });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      return res;
    },
    [token, queryClient],
  );
  const cancelSchedule = useCallback(async () => {
    const res = await api<{ ok: true; refundedLamports: string }>('/crash/schedule/cancel', {
      method: 'POST',
      body: {},
      token,
    });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    return res;
  }, [token, queryClient]);
  return { placeBet, cashOut, scheduleBet, cancelSchedule };
}
