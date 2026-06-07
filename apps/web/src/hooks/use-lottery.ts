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
  mainNumbers: number[];
  bonusNumber: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  slotHash: string; // hex — third entropy input, needed by the verifier
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
    // Bulk purchase tuning (server-driven — the client bundle can't import
    // runtime values from @scadium/shared).
    ticketPresets?: number[];
    batchTicketsPerTx?: number;
    maxBulkPerSubmit?: number;
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

export interface TicketPicks {
  mainNumbers: number[];
  bonusNumber: number;
}

/**
 * Bulk quick-pick purchase (20/50/100 at once — no per-draw cap, bc.game
 * parity). On-chain mode chunks the picks into `buy_tickets` batch
 * transactions (BATCH_TICKETS_PER_TX picks each, ONE USDT transfer per tx),
 * signs them all in a single wallet approval (signAllTransactions), sends
 * them, then registers each signature with /lottery/confirm — the API
 * records every ticket carried by the tx. Play-money mode just loops the
 * /lottery/ticket endpoint. `onProgress` fires per confirmed chunk so the
 * UI can render "Buying 24/100…".
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

      if (snap?.chain.enabled && snap.chain.programId && snap.chain.usdtMint && publicKey) {
        const programId = new PublicKey(snap.chain.programId);
        const usdtMint = new PublicKey(snap.chain.usdtMint);
        const latest = await connection.getLatestBlockhash();

        const perTx = snap.config.batchTicketsPerTx ?? 12;
        const chunks: TicketPicks[][] = [];
        for (let i = 0; i < tickets.length; i += perTx) {
          chunks.push(tickets.slice(i, i + perTx));
        }
        const txs = chunks.map((chunk) => {
          const tx = buildBuyTicketsTx(
            programId,
            usdtMint,
            publicKey,
            BigInt(snap.drawIndex),
            chunk.map((t) => ({
              main: [...t.mainNumbers].sort((a, b) => a - b),
              bonus: t.bonusNumber,
            })),
          );
          tx.feePayer = publicKey;
          tx.recentBlockhash = latest.blockhash;
          return tx;
        });

        // One wallet approval for the whole batch when the adapter supports it.
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
