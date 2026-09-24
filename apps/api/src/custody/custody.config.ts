import { LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Custody settings (ADR 0005). Read live, not at module load, so tests and
 * operators can change them without a rebuild. Every value has a default; the
 * origin of each is below and in `docs/runbooks/cloudflare.md`.
 *
 *  - CUSTODY_ENABLED (false): turns custody on — and with it the play/real
 *    economy rules (economy.ts). Deposits/withdrawals additionally need
 *    the cluster proof and the hot key (custody-runtime.ts); the economy rules do
 *    not, because funded balances exist even while the chain is unreachable.
 *  - CUSTODY_HOT_WALLET_SECRET_KEY: the treasury key (base58 or a JSON byte
 *    array). A secret: Worker secret → container env, never in the repo.
 *  - CUSTODY_COMMITMENT (finalized): when a deposit counts and a withdrawal is
 *    done. `finalized` (~13 s) cannot be rolled back by a fork.
 *  - CUSTODY_MIN_DEPOSIT_LAMPORTS (0.01 SOL): smaller deposits are held, and
 *    smaller transfers from unknown wallets are ignored (dust cannot fill the DB).
 *  - CUSTODY_MIN_WITHDRAW_LAMPORTS (0.01 SOL) / CUSTODY_MAX_WITHDRAW_LAMPORTS
 *    (10 SOL, per request) / CUSTODY_DAILY_WITHDRAW_LAMPORTS (25 SOL per user per
 *    UTC day): bound what one account can pull out of the hot wallet.
 *  - CUSTODY_FEE_RESERVE_LAMPORTS (0.01 SOL): kept in the hot wallet so it can
 *    always pay transaction fees.
 *  - CUSTODY_WITHDRAW_MAX_ATTEMPTS (5): provably-dead signatures before a
 *    withdrawal is refunded instead of re-signed.
 *  - CUSTODY_EXPIRY_MARGIN_BLOCKS (150, ~1 min of blocks): how far past its
 *    blockhash's expiry the finalized height must be before an unseen signature
 *    counts as dead — room for an RPC node that lags the cluster.
 *  - CUSTODY_SCAN_PAGE (1000, the RPC maximum): signatures per history page.
 */
export type CustodyCommitment = 'confirmed' | 'finalized';

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

function envLamports(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  return BigInt(raw);
}

const SOL = BigInt(LAMPORTS_PER_SOL);

export function custodyConfig() {
  const commitment = process.env.CUSTODY_COMMITMENT?.trim();
  return {
    enabled: process.env.CUSTODY_ENABLED?.trim() === 'true',
    hotWalletSecret: process.env.CUSTODY_HOT_WALLET_SECRET_KEY?.trim() || null,
    commitment: (commitment === 'confirmed' ? 'confirmed' : 'finalized') as CustodyCommitment,
    minDepositLamports: envLamports('CUSTODY_MIN_DEPOSIT_LAMPORTS', SOL / 100n),
    minWithdrawLamports: envLamports('CUSTODY_MIN_WITHDRAW_LAMPORTS', SOL / 100n),
    maxWithdrawLamports: envLamports('CUSTODY_MAX_WITHDRAW_LAMPORTS', 10n * SOL),
    dailyWithdrawLamports: envLamports('CUSTODY_DAILY_WITHDRAW_LAMPORTS', 25n * SOL),
    feeReserveLamports: envLamports('CUSTODY_FEE_RESERVE_LAMPORTS', SOL / 100n),
    withdrawMaxAttempts: envInt('CUSTODY_WITHDRAW_MAX_ATTEMPTS', 5),
    expiryMarginBlocks: envInt('CUSTODY_EXPIRY_MARGIN_BLOCKS', 150, 0),
    scanPage: Math.min(1000, envInt('CUSTODY_SCAN_PAGE', 1000)),
  };
}

export type CustodyConfig = ReturnType<typeof custodyConfig>;
