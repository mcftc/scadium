'use client';

import { useEffect, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { env } from '@/config/env';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

export type CrashPhase = 'waiting' | 'running' | 'busted';

export interface CrashBet {
  userId: string;
  username: string | null;
  walletAddress: string;
  amountLamports: string;
  autoCashout: number | null;
  cashedOutAt: number | null;
}

export interface CrashSnapshot {
  roundId: string;
  phase: CrashPhase;
  startedAt: number | null;
  serverSeedHash: string;
  bustPoint: number | null;
  multiplier: number;
  bets: CrashBet[];
  history: { bustPoint: number; roundId: string }[];
}

/**
 * Subscribes to the server-authoritative crash round. Seeds state from
 * the `/snapshot` REST endpoint, then tracks live updates via the
 * `/crash` Socket.io namespace.
 */
export function useCrash() {
  const [state, setState] = useState<CrashSnapshot | null>(null);
  const [, setTick] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // Seed from REST
    api<CrashSnapshot>('/crash/snapshot')
      .then(setState)
      .catch(() => {
        /* noop */
      });

    const sock = io(`${env.wsUrl.replace(/\/$/, '')}/crash`, {
      transports: ['websocket'],
      reconnection: true,
      withCredentials: true,
    });

    sock.on('crash:round-start', (p: { roundId: string; serverSeedHash: string }) => {
      setState((prev) => ({
        roundId: p.roundId,
        phase: 'waiting' as const,
        startedAt: null,
        serverSeedHash: p.serverSeedHash,
        bustPoint: null,
        multiplier: 1.0,
        bets: [],
        history: prev?.history ?? [],
      }));
    });

    sock.on('crash:running', () => {
      setState((s) => (s ? { ...s, phase: 'running', startedAt: Date.now() } : s));
    });

    sock.on('crash:tick', ({ multiplier }: { multiplier: number }) => {
      setState((s) => (s ? { ...s, multiplier } : s));
      setTick((t) => t + 1);
    });

    sock.on('crash:bust', ({ bustPoint }: { bustPoint: number }) => {
      setState((s) =>
        s
          ? {
              ...s,
              phase: 'busted',
              bustPoint,
              multiplier: bustPoint,
              history: [{ bustPoint, roundId: s.roundId }, ...s.history].slice(0, 20),
            }
          : s,
      );
    });

    sock.on('crash:bet-placed', (bet: CrashBet & { roundId: string }) => {
      setState((s) =>
        s
          ? {
              ...s,
              bets: [...s.bets.filter((b) => b.userId !== bet.userId), bet],
            }
          : s,
      );
    });

    sock.on(
      'crash:cashed-out',
      ({ userId, multiplier }: { userId: string; multiplier: number }) => {
        setState((s) =>
          s
            ? {
                ...s,
                bets: s.bets.map((b) =>
                  b.userId === userId ? { ...b, cashedOutAt: multiplier } : b,
                ),
              }
            : s,
        );
      },
    );

    setSocket(sock);
    return () => {
      sock.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state };
}

export function useCrashActions() {
  const token = useAuthStore((s) => s.accessToken);
  const placeBet = useCallback(
    (params: { amountLamports: string; autoCashout?: number | null }) =>
      api<{ ok: true; roundId: string }>('/crash/bet', {
        method: 'POST',
        body: {
          amountLamports: params.amountLamports,
          autoCashout: params.autoCashout ?? undefined,
        },
        token,
      }),
    [token],
  );
  const cashOut = useCallback(
    () => api<{ payoutLamports: string; multiplier: number }>('/crash/cashout', {
      method: 'POST',
      token,
    }),
    [token],
  );
  return { placeBet, cashOut };
}
