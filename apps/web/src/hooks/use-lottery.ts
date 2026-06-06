'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { api } from '@/lib/api-client';
import { buildBuyTicketTx } from '@/lib/lottery';
import { ata } from '@/lib/swap';
import { useAuthStore } from '@/store/auth-store';
import { useSocket } from '@/providers/socket-provider';

export interface LotteryLastResult {
  drawId: string;
  mainNumbers: number[];
  bonusNumber: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  winnersCount: number;
  drawnAt: number;
}

export interface LotterySnapshot {
  drawId: string;
  drawIndex: string;
  status: 'open' | 'drawn';
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  drawAt: number;
  ticketCount: number;
  potLamports: string;
  ticketPriceUsd: number;
  ticketPriceUsdtBase: string;
  commitTxSignature: string | null;
  chain: { enabled: boolean; programId: string | null; usdtMint: string | null };
  config: {
    mainCount: number;
    mainMax: number;
    bonusMax: number;
    prizesUsd: { grand: number; second: number; third: number; fourth: number };
    freeTicketOnZeroMatch: boolean;
  };
  lastResult: LotteryLastResult | null;
}

export interface MyLotteryTicket {
  id: string;
  drawId: string;
  mainNumbers: number[];
  bonusNumber: number;
  costLamports: string;
  matchedMain: number;
  matchedBonus: number;
  payoutLamports: string;
  won: boolean;
  drawStatus: 'open' | 'drawn';
  drawMain: number[];
  drawBonus: number | null;
  createdAt: string;
}

export interface LotteryDrawRow {
  id: string;
  mainNumbers: number[];
  bonusNumber: number | null;
  ticketCount: number;
  potLamports: string;
  drawnAt: string | null;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/** Live current-draw state, seeded from REST and patched over Socket.io. */
export function useLottery() {
  const [snap, setSnap] = useState<LotterySnapshot | null>(null);
  const socket = useSocket('/lottery');
  const qc = useQueryClient();

  useEffect(() => {
    api<LotterySnapshot>('/lottery/current').then(setSnap).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refetch = () => api<LotterySnapshot>('/lottery/current').then(setSnap).catch(() => {});
    const onTicket = (p: { ticketCount: number; potLamports: string }) =>
      setSnap((s) => (s ? { ...s, ticketCount: p.ticketCount, potLamports: p.potLamports } : s));
    const onResult = () => {
      refetch();
      qc.invalidateQueries({ queryKey: ['lottery', 'my-tickets'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'recent'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    };
    socket.on('lottery:draw-open', refetch);
    socket.on('lottery:ticket-sold', onTicket);
    socket.on('lottery:draw-result', onResult);
    return () => {
      socket.off('lottery:draw-open', refetch);
      socket.off('lottery:ticket-sold', onTicket);
      socket.off('lottery:draw-result', onResult);
    };
  }, [socket, qc]);

  return snap;
}

/**
 * Ticket purchase. On-chain mode (Phase E): build the user-signed buy_ticket
 * tx (0.1 USDT → treasury), confirm it, then register the signature with the
 * API. Falls back to the play-money endpoint when the chain is disabled.
 */
export function useBuyTicket(snap: LotterySnapshot | null) {
  const token = useAuthStore((s) => s.accessToken);
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { mainNumbers: number[]; bonusNumber: number }) => {
      if (snap?.chain.enabled && snap.chain.programId && snap.chain.usdtMint && publicKey) {
        const tx = buildBuyTicketTx(
          new PublicKey(snap.chain.programId),
          new PublicKey(snap.chain.usdtMint),
          publicKey,
          BigInt(snap.drawIndex),
          [...params.mainNumbers].sort((a, b) => a - b),
          params.bonusNumber,
        );
        const latest = await connection.getLatestBlockhash();
        const signature = await sendTransaction(tx, connection);
        await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
        return api('/lottery/confirm', { method: 'POST', body: { signature }, token });
      }
      return api('/lottery/ticket', { method: 'POST', body: params, token });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'my-tickets'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'usdt'] });
    },
  });
}

/** The caller's on-chain USDT balance (lottery currency). */
export function useUsdtBalance(snap: LotterySnapshot | null) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery({
    queryKey: ['lottery', 'usdt', publicKey?.toBase58()],
    enabled: !!publicKey && !!snap?.chain.enabled && !!snap.chain.usdtMint,
    queryFn: async () => {
      const acct = await connection
        .getTokenAccountBalance(ata(new PublicKey(snap!.chain.usdtMint!), publicKey!))
        .catch(() => null);
      return acct?.value.amount ?? '0';
    },
    refetchInterval: 15_000,
  });
}

/** Wager-loyalty free tickets: 1 per 1 SOL wagered across all games. */
export function useFreeTickets() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['lottery', 'free-tickets'],
    enabled: !!token,
    queryFn: () =>
      api<{ available: number; progressLamports: string; perWagerLamports: string }>(
        '/lottery/free-tickets',
        { token },
      ),
    refetchInterval: 30_000,
  });
}

export function useUseFreeTicket() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { mainNumbers: number[]; bonusNumber: number }) =>
      api('/lottery/ticket/free', { method: 'POST', body: params, token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lottery', 'my-tickets'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'free-tickets'] });
    },
  });
}

export function useUsdtFaucet() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/lottery/faucet', { method: 'POST', token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lottery', 'usdt'] }),
  });
}

export function useMyLotteryTickets() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['lottery', 'my-tickets'],
    enabled: !!token,
    queryFn: () => api<MyLotteryTicket[]>('/lottery/my-tickets', { token }),
  });
}

export function useRecentDraws() {
  return useQuery({
    queryKey: ['lottery', 'recent'],
    queryFn: () => api<LotteryDrawRow[]>('/lottery/recent'),
    staleTime: 15_000,
  });
}
