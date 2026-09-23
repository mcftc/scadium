'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

/**
 * Backoff for a snapshot request that fails. The API container sleeps when the
 * site is idle and its first request after a wake fails by design (~36s boot),
 * so a page loaded cold must keep asking instead of sitting on "Connecting…".
 */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];

/**
 * The REST snapshot behind a live game page (jackpot, lottery). `refetch()` is
 * safe to call from any socket event: only the NEWEST request may land, so an
 * older response arriving late can never roll the page back to a stale round.
 */
export function useLiveSnapshot<T>(path: string) {
  const [snap, setSnap] = useState<T | null>(null);
  const requestSeq = useRef(0);

  const refetch = useCallback((): void => {
    const seq = ++requestSeq.current;
    // Retries keep this request's seq, so a newer refetch supersedes them too.
    const load = (attempt: number): void => {
      api<T>(path)
        .then((s) => {
          if (seq === requestSeq.current) setSnap(s);
        })
        .catch(() => {
          const delay = RETRY_DELAYS_MS[attempt];
          if (delay !== undefined && seq === requestSeq.current) {
            setTimeout(() => load(attempt + 1), delay);
          }
        });
    };
    load(0);
  }, [path]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { snap, setSnap, refetch };
}
