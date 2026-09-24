'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, postOnce } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useMe } from '@/hooks/use-me';

/** GET /custody/config — what the wallet page needs (ADR 0005). */
export interface CustodyConfig {
  enabled: boolean;
  active: boolean;
  inactiveReason: string | null;
  cluster: 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet' | null;
  treasury: string | null;
  commitment: 'confirmed' | 'finalized';
  minDepositLamports: string;
  minWithdrawLamports: string;
  maxWithdrawLamports: string;
  dailyWithdrawLamports: string;
}

export type HoldReason =
  | 'unattributed'
  | 'ambiguous_sender'
  | 'below_minimum'
  | 'paused'
  | 'deposit_limit'
  | 'age_unverified'
  | 'open_play_positions';

export interface CustodyTransfer {
  id: string;
  kind: 'deposit' | 'withdraw';
  status: 'held' | 'credited' | 'pending' | 'sent' | 'confirmed' | 'failed';
  amountLamports: string;
  wallet: string;
  txSignature: string | null;
  heldReason: HoldReason | null;
  createdAt: string;
  settledAt: string | null;
}

const IN_FLIGHT: CustodyTransfer['status'][] = ['held', 'pending', 'sent'];

export function useCustodyConfig() {
  return useQuery({
    queryKey: ['custody', 'config'],
    queryFn: () => api<CustodyConfig>('/custody/config'),
    staleTime: 60_000,
  });
}

/** The caller's deposits and withdrawals; polls fast while one is still moving. */
export function useCustodyTransfers() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['custody', 'transfers'],
    enabled: !!token,
    queryFn: () => api<CustodyTransfer[]>('/custody/transfers', { token }),
    refetchInterval: (q) =>
      q.state.data?.some((t) => IN_FLIGHT.includes(t.status)) ? 3_000 : 30_000,
  });
}

function useRefreshBalances() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['custody', 'transfers'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
}

/**
 * Confirm a deposit the wallet already sent. The API answers `pending` until
 * the transaction reaches its commitment, so this polls for up to a minute —
 * the treasury scan credits it later anyway if the page is closed.
 */
export function useConfirmDeposit() {
  const token = useAuthStore((s) => s.accessToken);
  const refresh = useRefreshBalances();
  return useMutation({
    mutationFn: async (signature: string) => {
      for (let i = 0; i < 30; i += 1) {
        const r = await api<CustodyTransfer | { status: 'pending' }>('/custody/deposits', {
          method: 'POST',
          token,
          body: { signature },
        });
        if ('id' in r || r.status !== 'pending') return r;
        await new Promise((res) => setTimeout(res, 2_000));
      }
      return { status: 'pending' as const };
    },
    onSettled: refresh,
  });
}

export function useScanDeposits() {
  const token = useAuthStore((s) => s.accessToken);
  const refresh = useRefreshBalances();
  return useMutation({
    mutationFn: () =>
      api<{ recorded: number; credited: number }>('/custody/deposits/scan', { method: 'POST', token }),
    onSettled: refresh,
  });
}

export function useWithdraw() {
  const token = useAuthStore((s) => s.accessToken);
  const refresh = useRefreshBalances();
  return useMutation({
    mutationFn: (amountLamports: string) =>
      postOnce<CustodyTransfer>('/custody/withdrawals', { amountLamports }, token),
    onSettled: refresh,
  });
}

/**
 * True when custody is on and the signed-in account has not deposited yet —
 * jackpot and lottery are then closed to it (one shared pot per round).
 */
export function useNeedsDeposit(): boolean {
  const { data: cfg } = useCustodyConfig();
  const { data: me } = useMe();
  return !!cfg?.enabled && !!me && !me.funded;
}
