import { resolveNetworkConfig, type SolanaNetwork } from '@scadium/shared';

/**
 * Centralized env access — avoids scattering process.env across the app and
 * gives us one place to fall back to sensible dev defaults.
 *
 * All values are read at build time for Next.js public vars (NEXT_PUBLIC_*).
 *
 * Network/RPC (#185) go through the SAME shared resolver as the api, so the rule
 * is identical on both sides: the RPC default is DERIVED from the selected
 * network (never a fixed devnet string), an unset network defaults to devnet
 * (the play-money/beta default — a prod build with no network set still builds),
 * and selecting mainnet without an explicit RPC fails closed. The NEXT_PUBLIC_*
 * values are inlined at build time, so the resolver runs against the build-time
 * env — a mainnet build with no RPC throws at build rather than shipping a bundle
 * that would talk to the wrong cluster.
 */
const network = resolveNetworkConfig(
  process.env.NEXT_PUBLIC_SOLANA_NETWORK,
  process.env.NEXT_PUBLIC_SOLANA_RPC,
);

export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000',
  solanaNetwork: network.network as SolanaNetwork,
  solanaRpc: network.rpcUrl,
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Scadium',
  // Privy social login (#203). Empty string = Privy disabled (the provider tree
  // renders without it, and the Google/Apple buttons are hidden) — SIWS wallet
  // auth is unaffected.
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '',
} as const;
