'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTOBET } from '@scadium/shared';
import type { InstantSettleResult } from '@/hooks/use-instant-game';

export type ProgressionMode = 'reset' | 'increase';

export interface AutoBetConfig {
  /** Number of bets; 0 = run until stopped or a stop-condition trips. */
  numberOfBets: number;
  /** Stake action after a winning bet. */
  onWin: { mode: ProgressionMode; pct: number };
  /** Stake action after a losing bet. */
  onLoss: { mode: ProgressionMode; pct: number };
  /** Stop once cumulative session profit reaches this (lamports), or null. */
  stopProfitLamports: bigint | null;
  /** Stop once cumulative session loss reaches this (lamports), or null. */
  stopLossLamports: bigint | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clampBig = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Game-agnostic auto-bet engine for the single-shot instant games. Because their
 * `/play` returns the settled result synchronously, the loop can `await` each
 * bet, read the outcome, apply on-win/on-loss stake progression, and honour
 * stop-on-profit / stop-on-loss / number-of-bets — capabilities crash's
 * round-driven auto-bet can't have. The panel supplies `runBet` (which places
 * ONE bet at a given stake with the game's current params) and a reader for the
 * base stake; the hook owns the loop, the running stake, and the stop logic.
 *
 * Safety: bets are placed strictly one at a time (each awaited), the running
 * stake is clamped to [min, max] every step, ANY bet error stops the loop
 * (server balance/RG rejection surfaces here), and unmount halts it. The server
 * is authoritative for balance + RG on every iteration — the loop cannot bypass
 * a limit the manual path enforces.
 */
export function useAutoBet(params: {
  runBet: (amountLamports: string) => Promise<InstantSettleResult>;
  /** Current base stake (lamports) — read fresh at start from the amount field. */
  baseStakeLamports: () => bigint;
  minLamports: number;
  maxLamports: number;
  onError?: (message: string) => void;
}) {
  const { minLamports, maxLamports } = params;
  // Mirror the latest callbacks into refs so the async loop always calls the
  // current closures (fresh game params) without re-subscribing. Updated in an
  // effect (not during render); `start` only ever runs from an event handler,
  // after the effect has committed, so the refs are current when it reads them.
  const runBetRef = useRef(params.runBet);
  const baseRef = useRef(params.baseStakeLamports);
  const onErrorRef = useRef(params.onError);
  useEffect(() => {
    runBetRef.current = params.runBet;
    baseRef.current = params.baseStakeLamports;
    onErrorRef.current = params.onError;
  });

  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  // Monotonic run token. Every start/stop/unmount bumps it, so a loop only stays
  // alive while `genRef.current` still equals the generation it captured at start.
  // This is what prevents a stop→restart (while a bet is in flight or during the
  // inter-bet sleep) from resurrecting the old loop — the shared boolean alone
  // let two loops run concurrently.
  const genRef = useRef(0);
  // Resolves when the most recently started loop has fully finished (incl. its
  // last in-flight bet). A new run awaits it before placing its first bet, so a
  // stop→restart never has the old session's in-flight bet overlap the new
  // session's first — at most ONE bet is ever in flight.
  const loopRef = useRef<Promise<void>>(Promise.resolve());
  const [currentStakeLamports, setCurrentStakeLamports] = useState<bigint>(0n);
  const [betsRemaining, setBetsRemaining] = useState<number | null>(null);
  const [sessionProfitLamports, setSessionProfitLamports] = useState<bigint>(0n);

  const stop = useCallback(() => {
    genRef.current += 1; // supersede the live loop
    runningRef.current = false;
    setRunning(false);
  }, []);

  // Halt the loop if the component unmounts mid-run.
  useEffect(
    () => () => {
      genRef.current += 1;
      runningRef.current = false;
    },
    [],
  );

  const start = useCallback(
    (cfg: AutoBetConfig) => {
      if (runningRef.current) return loopRef.current; // already live (genuine double-start)
      const myGen = ++genRef.current; // this run's identity; a newer start/stop supersedes it
      const alive = () => genRef.current === myGen;
      const min = BigInt(minLamports);
      const max = BigInt(maxLamports);

      runningRef.current = true;
      setRunning(true);

      const prev = loopRef.current;
      const run = (async () => {
        try {
          // Let any prior loop's in-flight bet fully drain first (≤1 bet ever
          // in flight); bail if a stop/restart superseded us while waiting.
          await prev.catch(() => undefined);
          if (!alive()) return;

          const base = clampBig(baseRef.current(), min, max);
          let stake = base;
          // 0 → unbounded (until stop / stop-condition / error); else a capped count.
          let remaining =
            cfg.numberOfBets > 0 ? Math.min(cfg.numberOfBets, AUTOBET.MAX_BETS) : Infinity;
          let profit = 0n;
          setSessionProfitLamports(0n);
          setCurrentStakeLamports(stake);
          setBetsRemaining(Number.isFinite(remaining) ? remaining : null);

          while (alive() && remaining > 0) {
            let res: InstantSettleResult;
            try {
              res = await runBetRef.current(stake.toString());
            } catch (e) {
              if (alive()) {
                onErrorRef.current?.(e instanceof Error ? e.message : 'Auto-bet stopped');
              }
              break;
            }
            if (!alive()) break; // superseded (stop/restart/unmount) while in flight
            remaining -= 1;
            setBetsRemaining(Number.isFinite(remaining) ? remaining : null);

            profit += BigInt(res.payoutLamports) - BigInt(res.amountLamports);
            setSessionProfitLamports(profit);

            // Stop conditions evaluated on the realised session P/L after the bet.
            if (cfg.stopProfitLamports !== null && profit >= cfg.stopProfitLamports) break;
            if (cfg.stopLossLamports !== null && -profit >= cfg.stopLossLamports) break;
            if (remaining <= 0) break;

            // Stake progression for the NEXT bet (2-dp precision on the percent).
            const rule = res.won ? cfg.onWin : cfg.onLoss;
            stake =
              rule.mode === 'reset'
                ? base
                : clampBig(
                    (stake * BigInt(Math.round((100 + rule.pct) * 100))) / 10_000n,
                    min,
                    max,
                  );
            setCurrentStakeLamports(stake);

            await sleep(AUTOBET.BET_INTERVAL_MS);
          }
        } finally {
          // Only clear the shared state if WE are still the current run — a
          // superseded loop must not stomp the newer loop's running=true.
          if (alive()) {
            runningRef.current = false;
            setRunning(false);
          }
        }
      })();
      loopRef.current = run;
      return run;
    },
    [minLamports, maxLamports],
  );

  return { running, start, stop, currentStakeLamports, betsRemaining, sessionProfitLamports };
}
