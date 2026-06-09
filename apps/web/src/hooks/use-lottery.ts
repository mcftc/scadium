'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, type Transaction } from '@solana/web3.js';
import { api } from '@/lib/api-client';
import { buildBuyTicketTx, buildBuyTicketsTx } from '@/lib/lottery';
import { ata } from '@/lib/swap';
import { useAuthStore } from '@/store/auth-store';
import { useSocket } from '@/providers/socket-provider';

export interface LotteryLastResult {
  drawId: string;
  drawIndex: string;
  digits: number[];
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  slotHash: string; // hex — third entropy input, needed by the verifier
  winnersCount: number;
  bracketWinnerCounts: number[];
  totalPoolScad: number;
  burnScad: number;
  topPrizeScad: number;
  drawnAt: number;
}

export interface LotteryConfig {
  digits: number; // 6
  digitMax: number; // 9 (top digit value)
  bracketCount: number; // 6
  rewardsBreakdownBps: number[]; // [125,375,750,1250,2500,5000]
  burnBps: number; // 2000
  discountDivisor: number;
  maxTicketsPerPurchase: number;
  freeTicketPerSolWagered: boolean;
  ticketPresets?: number[];
  batchTicketsPerTx?: number;
  maxManualRows?: number;
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
  ticketPriceScadBase: string;
  ticketPriceScad: number;
  ticketPriceUsd: number;
  injectionScadBase: string;
  rolloverScadBase: string;
  totalPoolScadBase: string;
  totalPoolScad: number;
  latestWinningPrizeScad: number;
  commitTxSignature: string | null;
  chain: { enabled: boolean; programId: string | null; scadMint: string | null };
  config: LotteryConfig;
  lastResult: LotteryLastResult | null;
}

export interface MyLotteryTicket {
  id: string;
  drawId: string;
  gameNumber: string;
  digits: number[];
  costScad: number;
  matchLen: number;
  bracket: number | null;
  payoutScad: number;
  free: boolean;
  won: boolean;
  drawStatus: 'open' | 'drawn';
  drawDigits: number[];
  createdAt: string;
}

export interface LotteryPlayer {
  username: string | null;
  walletAddress: string;
  avatarUrl: string | null;
}

export interface DrawWinner {
  player: LotteryPlayer;
  digits: number[];
  matchLen: number;
  bracket: number | null;
  payoutScad: number;
}

export interface DrawResults {
  drawId: string;
  drawIndex: string | null;
  gameNumber: string;
  status: 'open' | 'drawn';
  drawAt: string;
  drawnAt: string | null;
  digits: number[];
  ticketCount: number;
  totalPoolScad: number;
  burnScad: number;
  bracketWinnerCounts: number[];
  bracketAmountsScad: number[];
  commitTxSignature: string | null;
  revealTxSignature: string | null;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  slotHash: string | null;
  winnersCount: number;
  winners: DrawWinner[];
}

export interface JackpotWinnerRow {
  drawIndex: string | null;
  gameNumber: string;
  drawnAt: string | null;
  player: LotteryPlayer;
  digits: number[];
  matchLen: number;
  bracket: number | null;
  payoutScad: number;
}

export interface MyLotteryStats {
  totalTickets: number;
  winningTickets: number;
  totalPrizeScad: number;
}

export interface LotteryDrawRow {
  id: string;
  drawIndex: string | null;
  gameNumber: string;
  digits: number[];
  ticketCount: number;
  totalPoolScad: number;
  drawnAt: string | null;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  slotHash: string | null;
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
    const onTicket = (p: { ticketCount: number; potLamports: string; totalPoolScadBase: string }) =>
      setSnap((s) =>
        s
          ? {
              ...s,
              ticketCount: p.ticketCount,
              potLamports: p.potLamports,
              totalPoolScadBase: p.totalPoolScadBase,
              totalPoolScad: Number(p.totalPoolScadBase) / 1e9,
            }
          : s,
      );
    const onResult = () => {
      refetch();
      qc.invalidateQueries({ queryKey: ['lottery', 'my-tickets'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'recent'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'results'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'jackpot-winners'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'my-stats'] });
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
 * Single-ticket purchase. On-chain mode: build the user-signed buy_ticket tx
 * ($SCAD → treasury), confirm it, then register the signature with the API.
 * Falls back to the play-money endpoint when the chain is disabled.
 */
export function useBuyTicket(snap: LotterySnapshot | null) {
  const token = useAuthStore((s) => s.accessToken);
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { digits: number[] }) => {
      if (snap?.chain.enabled && snap.chain.programId && snap.chain.scadMint && publicKey) {
        const tx = buildBuyTicketTx(
          new PublicKey(snap.chain.programId),
          new PublicKey(snap.chain.scadMint),
          publicKey,
          BigInt(snap.drawIndex),
          params.digits,
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
      qc.invalidateQueries({ queryKey: ['lottery', 'scad'] });
    },
  });
}

export interface TicketPicks {
  digits: number[];
}

/**
 * Bulk quick-pick purchase. On-chain mode chunks picks into `buy_tickets`
 * batch transactions (BATCH_TICKETS_PER_TX picks each, ONE bulk-discounted
 * $SCAD transfer per tx), signs them in a single wallet approval, sends them,
 * then registers each signature with /lottery/confirm. Play-money mode loops
 * the /lottery/ticket endpoint. `onProgress` fires per confirmed chunk.
 */
export function useBuyBulkTickets(snap: LotterySnapshot | null) {
  const token = useAuthStore((s) => s.accessToken);
  const { connection } = useConnection();
  const { publicKey, signAllTransactions, sendTransaction } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      tickets,
      onProgress,
    }: {
      tickets: TicketPicks[];
      onProgress?: (done: number) => void;
    }) => {
      let done = 0;

      if (snap?.chain.enabled && snap.chain.programId && snap.chain.scadMint && publicKey) {
        const programId = new PublicKey(snap.chain.programId);
        const scadMint = new PublicKey(snap.chain.scadMint);
        const latest = await connection.getLatestBlockhash();

        const perTx = snap.config.batchTicketsPerTx ?? 12;
        const chunks: TicketPicks[][] = [];
        for (let i = 0; i < tickets.length; i += perTx) {
          chunks.push(tickets.slice(i, i + perTx));
        }
        const txs = chunks.map((chunk) => {
          const tx = buildBuyTicketsTx(
            programId,
            scadMint,
            publicKey,
            BigInt(snap.drawIndex),
            chunk.map((t) => ({ digits: t.digits })),
          );
          tx.feePayer = publicKey;
          tx.recentBlockhash = latest.blockhash;
          return tx;
        });

        let signatures: string[];
        if (signAllTransactions) {
          const signed: Transaction[] = await signAllTransactions(txs);
          signatures = [];
          for (const tx of signed) {
            signatures.push(await connection.sendRawTransaction(tx.serialize()));
          }
        } else {
          signatures = [];
          for (const tx of txs) {
            signatures.push(await sendTransaction(tx, connection));
          }
        }

        const results = [];
        for (let i = 0; i < signatures.length; i++) {
          const signature = signatures[i]!;
          await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
          const res = await api<{ count: number }>('/lottery/confirm', {
            method: 'POST',
            body: { signature },
            token,
          });
          done += res.count ?? chunks[i]!.length;
          onProgress?.(done);
          results.push(res);
        }
        return results;
      }

      // Play-money fallback (chain disabled).
      const results = [];
      for (const t of tickets) {
        results.push(await api('/lottery/ticket', { method: 'POST', body: t, token }));
        onProgress?.(++done);
      }
      return results;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'my-tickets'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'scad'] });
    },
  });
}

/** Bulk-discounted $SCAD price for N tickets this round (server is source of truth). */
export function useBulkPrice(count: number) {
  return useQuery({
    queryKey: ['lottery', 'price', count],
    queryFn: () =>
      api<{
        count: number;
        unitScadBase: string;
        totalScadBase: string;
        totalScad: number;
        discountBps: number;
      }>(`/lottery/price?count=${count}`),
    staleTime: 60_000,
  });
}

/** The caller's on-chain $SCAD balance (lottery currency). */
export function useScadBalance(snap: LotterySnapshot | null) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery({
    queryKey: ['lottery', 'scad', publicKey?.toBase58()],
    enabled: !!publicKey && !!snap?.chain.enabled && !!snap.chain.scadMint,
    queryFn: async () => {
      const acct = await connection
        .getTokenAccountBalance(ata(new PublicKey(snap!.chain.scadMint!), publicKey!))
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
    mutationFn: (params: { digits: number[] }) =>
      api('/lottery/ticket/free', { method: 'POST', body: params, token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lottery', 'my-tickets'] });
      qc.invalidateQueries({ queryKey: ['lottery', 'free-tickets'] });
    },
  });
}

export function useScadFaucet() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/lottery/faucet', { method: 'POST', token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lottery', 'scad'] }),
  });
}

export function useMyLotteryTickets(limit = 20, wonOnly = false) {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['lottery', 'my-tickets', limit, wonOnly],
    enabled: !!token,
    queryFn: () =>
      api<MyLotteryTicket[]>(
        `/lottery/my-tickets?limit=${limit}${wonOnly ? '&won=true' : ''}`,
        { token },
      ),
  });
}

export function useRecentDraws(limit = 10) {
  return useQuery({
    queryKey: ['lottery', 'recent', limit],
    queryFn: () => api<LotteryDrawRow[]>(`/lottery/recent?limit=${limit}`),
    staleTime: 15_000,
  });
}

/** One round's full results (winning number + public winners list). */
export function useDrawResults(drawIndex: string | null) {
  return useQuery({
    queryKey: ['lottery', 'results', drawIndex],
    enabled: !!drawIndex,
    queryFn: () => api<DrawResults>(`/lottery/draws/${drawIndex}/results`),
    staleTime: 15_000,
  });
}

/** Historical jackpot winners (Jackpot Winners tab). */
export function useJackpotWinners() {
  return useQuery({
    queryKey: ['lottery', 'jackpot-winners'],
    queryFn: () => api<JackpotWinnerRow[]>('/lottery/jackpot-winners'),
    staleTime: 30_000,
  });
}

/** The caller's lifetime lottery stats (My Bets cards). */
export function useMyLotteryStats() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['lottery', 'my-stats'],
    enabled: !!token,
    queryFn: () => api<MyLotteryStats>('/lottery/my-stats', { token }),
  });
}
