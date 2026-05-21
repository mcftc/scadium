/**
 * Centralized env access — avoids scattering process.env across the app and
 * gives us one place to fall back to sensible dev defaults.
 *
 * All values are read at build time for Next.js public vars (NEXT_PUBLIC_*).
 */
export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000',
  solanaNetwork: (process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet') as
    | 'mainnet-beta'
    | 'devnet'
    | 'testnet'
    | 'localnet',
  solanaRpc: process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com',
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Scadium',
} as const;
