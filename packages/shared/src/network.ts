/**
 * Network-config resolver (#185, sliced from #53) — the SINGLE source of truth
 * for "which Solana cluster am I on, and which RPC do I talk to" used by BOTH the
 * api (NestJS) and the web (Next.js). Pure & injectable: it reads no env itself —
 * callers pass the raw env values in, so the rule is identical on both sides and
 * unit-testable.
 *
 * Money-safety (the bug this closes): the old code defaulted the RPC to a fixed
 * `https://api.devnet.solana.com` string INDEPENDENT of the selected network. So
 * `SOLANA_NETWORK=mainnet-beta` with no RPC set silently talked to DEVNET while
 * the app believed it was on mainnet. Here the RPC default is always DERIVED from
 * the resolved network, and mainnet with no RPC FAILS CLOSED in production.
 *
 * Fail-closed rule:
 *   - network unset + production           → throw (operator must be explicit)
 *   - network unset + dev/beta             → 'devnet' (play-money beta unchanged)
 *   - rpc explicitly set                   → use it verbatim
 *   - rpc unset + devnet/testnet           → that cluster's public RPC
 *   - rpc unset + mainnet-beta, production → throw (never guess a mainnet RPC)
 *   - rpc unset + mainnet-beta, dev        → mainnet-beta public RPC (convenience)
 */

export const SOLANA_NETWORKS = ['mainnet-beta', 'devnet', 'testnet', 'localnet'] as const;
export type SolanaNetwork = (typeof SOLANA_NETWORKS)[number];

/** Public RPC endpoints per cluster. localnet has no public default. */
const PUBLIC_RPC: Record<SolanaNetwork, string | null> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
};

export interface ResolvedNetworkConfig {
  network: SolanaNetwork;
  rpcUrl: string;
}

/**
 * Normalize a raw env value to a known network. Accepts the common `mainnet`
 * alias for `mainnet-beta`. Returns null for unset/unknown so the caller can
 * apply the fail-closed-in-prod rule.
 */
function normalizeNetwork(raw: string | undefined | null): SolanaNetwork | null {
  const n = raw?.trim();
  if (!n) return null;
  if (n === 'mainnet' || n === 'mainnet-beta') return 'mainnet-beta';
  return (SOLANA_NETWORKS as readonly string[]).includes(n) ? (n as SolanaNetwork) : null;
}

/**
 * Resolve the effective `{ network, rpcUrl }` from raw env values.
 *
 * @param rawNetwork  the `SOLANA_NETWORK` / `NEXT_PUBLIC_SOLANA_NETWORK` value
 * @param explicitRpc the `SOLANA_RPC_URL` / `NEXT_PUBLIC_SOLANA_RPC` value, if any
 * @param isProd      whether this is a production boot (drives fail-closed)
 */
export function resolveNetworkConfig(
  rawNetwork: string | undefined | null,
  explicitRpc: string | undefined | null,
  isProd: boolean,
): ResolvedNetworkConfig {
  const normalized = normalizeNetwork(rawNetwork);
  if (normalized === null) {
    if (rawNetwork?.trim()) {
      // Set but unrecognised — always a hard error, even in dev: a typo'd
      // network must never silently fall back to devnet.
      throw new Error(
        `Invalid SOLANA_NETWORK "${rawNetwork}". Expected one of: ${SOLANA_NETWORKS.join(', ')} (or "mainnet").`,
      );
    }
    if (isProd) {
      throw new Error(
        'SOLANA_NETWORK is not set. In production the network must be explicit (no devnet default). ' +
          `Set SOLANA_NETWORK to one of: ${SOLANA_NETWORKS.join(', ')}.`,
      );
    }
    // dev/beta: preserve the historical play-money default.
    return resolveWithNetwork('devnet', explicitRpc, isProd);
  }
  return resolveWithNetwork(normalized, explicitRpc, isProd);
}

function resolveWithNetwork(
  network: SolanaNetwork,
  explicitRpc: string | undefined | null,
  isProd: boolean,
): ResolvedNetworkConfig {
  const rpc = explicitRpc?.trim();
  if (rpc) return { network, rpcUrl: rpc };

  // No explicit RPC → derive from the resolved network (NEVER a fixed devnet URL).
  if (network === 'mainnet-beta' && isProd) {
    // Never guess a public mainnet RPC under real load in production — the
    // public endpoint is rate-limited and the operator must choose one.
    throw new Error(
      'SOLANA_NETWORK=mainnet-beta but no RPC URL is set. In production a mainnet RPC must be ' +
        'explicit (SOLANA_RPC_URL / NEXT_PUBLIC_SOLANA_RPC) — refusing to default. Provision a ' +
        'dedicated RPC endpoint.',
    );
  }

  const derived = PUBLIC_RPC[network];
  if (!derived) {
    throw new Error(
      `SOLANA_NETWORK=${network} has no default RPC URL. Set SOLANA_RPC_URL / NEXT_PUBLIC_SOLANA_RPC explicitly.`,
    );
  }
  return { network, rpcUrl: derived };
}
