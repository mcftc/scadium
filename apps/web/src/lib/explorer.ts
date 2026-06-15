import { env } from '@/config/env';

/**
 * Solscan explorer links, cluster-aware (#53). Solscan defaults to mainnet, so
 * the `?cluster=` query is appended only for non-mainnet networks. Centralised
 * here so no surface hardcodes `?cluster=devnet` — flipping `NEXT_PUBLIC_SOLANA_NETWORK`
 * to `mainnet-beta` at launch updates every link with no code change.
 */
const BASE = 'https://solscan.io';

function clusterSuffix(): string {
  const n = env.solanaNetwork;
  // Solscan only recognises devnet/testnet as cluster params (mainnet-beta is its
  // default, no param). localnet/unknown have no Solscan cluster, so omit the
  // param — the link opens on mainnet rather than producing a broken URL.
  return n === 'devnet' || n === 'testnet' ? `?cluster=${n}` : '';
}

export const solscanTx = (signature: string) => `${BASE}/tx/${signature}${clusterSuffix()}`;
export const solscanAccount = (address: string) => `${BASE}/account/${address}${clusterSuffix()}`;
export const solscanToken = (mint: string) => `${BASE}/token/${mint}${clusterSuffix()}`;
