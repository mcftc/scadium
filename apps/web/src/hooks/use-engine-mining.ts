'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

export interface EngineState {
  /** 4-year halving era (0 = years 0–4, 1 = 4–8, …). */
  era: number;
  /** Years per halving (= 4). */
  halvingYears: number;
  /** ms until the next 4-year halving. */
  nextHalvingMs: number;
  totalEmittedScad: string;
  remainingPoolScad: string;
  p2ePoolScad: string;
  currentBlockRewardScad: string;
  bigRewardScad: string;
  bigRewardBps: number;
  msToNextDistribution: number;
  lastBlock: {
    period: string;
    rewardScad: string;
    participantCount: number;
    winnerId: string | null;
    bigRewardScad: string;
    distributedAt: string | null;
  } | null;
}

export interface MinerState {
  playRate: string;
  activePlayRate: string;
  stakePlayRate: string;
  totalPlayRate: string;
  shareBps: number;
  projectedShareScad: string;
  mining: boolean;
  miningPassively: boolean;
}

export interface EngineBlock {
  period: string;
  rewardScad: string;
  totalPlayRate: string;
  participantCount: number;
  winnerId: string | null;
  bigRewardScad: string;
  drawSeed: string | null;
  drawSeedHash: string | null;
  distributedAt: string | null;
}

export interface MiningLeaderboard {
  totalPlayRate: string;
  miners: {
    rank: number;
    userId: string;
    username: string | null;
    walletAddress: string | null;
    playRate: string;
    shareBps: number;
  }[];
}

export function useEngineState() {
  return useQuery({
    queryKey: ['engine', 'state'],
    queryFn: () => api<EngineState>('/engine/state'),
    refetchInterval: 15_000,
  });
}

export function useMinerState() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['engine', 'me'],
    queryFn: () => api<MinerState>('/engine/me', { token }),
    enabled: !!token,
    refetchInterval: 15_000,
  });
}

export function useEngineBlocks(limit = 8) {
  return useQuery({
    queryKey: ['engine', 'blocks', limit],
    queryFn: () => api<EngineBlock[]>(`/engine/blocks?limit=${limit}`),
    refetchInterval: 30_000,
  });
}

export function useMiningLeaderboard(limit = 10) {
  return useQuery({
    queryKey: ['engine', 'leaderboard', limit],
    queryFn: () => api<MiningLeaderboard>(`/engine/leaderboard?limit=${limit}`),
    refetchInterval: 20_000,
  });
}

/**
 * bc.game-style live $SCAD ticker: interpolates the cumulative emission UPWARD
 * between polls at the current block's per-second emission rate
 * (currentBlockReward / 3600s), resetting to the authoritative value on each new
 * poll. Returns whole-$SCAD as a number for display. Honours reduced-motion by
 * holding the polled value steady (no animation).
 */
export function useLiveEmittedScad(state: EngineState | undefined): number {
  const emitted = state ? Number(BigInt(state.totalEmittedScad) / 1_000_000_000n) : 0; // whole $SCAD
  const [display, setDisplay] = useState(emitted);

  // Snap the display to the freshly-polled value when it changes — React's
  // documented "adjust state during render" pattern, which avoids resetting
  // state inside the effect (react-hooks/set-state-in-effect).
  const [synced, setSynced] = useState(emitted);
  if (synced !== emitted) {
    setSynced(emitted);
    setDisplay(emitted);
  }

  useEffect(() => {
    if (!state) return;
    const ratePerMs = Number(BigInt(state.currentBlockRewardScad) / 1_000_000_000n) / 3_600_000;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || ratePerMs <= 0) return;

    // Interpolate upward from the polled value at the per-second emission rate.
    const start = Number(BigInt(state.totalEmittedScad) / 1_000_000_000n);
    const at = performance.now();
    const id = setInterval(() => {
      setDisplay(start + ratePerMs * (performance.now() - at));
    }, 120);
    return () => clearInterval(id);
  }, [state]);

  return display;
}
