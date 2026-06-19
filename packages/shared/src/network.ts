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
 * the resolved network, and choosing mainnet without an RPC FAILS CLOSED.
 *
 * The fail-closed signal is *selecting mainnet*, NOT `NODE_ENV`. The play-money
 * beta runs with `NODE_ENV=production` yet legitimately wants the devnet default,
 * and CI builds/tests run in prod mode too — so gating on `NODE_ENV` would break
 * them. The dangerous case is the inverse (believe mainnet, talk devnet), which
 * is impossible here because mainnet requires an explicit RPC.
 *
 * Resolution rule:
 *   - network unset/blank                  → 'devnet' (play-money beta + CI default)
 *   - network set but unknown/typo         → throw (never silently fall back to devnet)
 *   - rpc explicitly set                   → use it verbatim
 *   - rpc unset + devnet/testnet/localnet  → that cluster's public RPC
 *   - rpc unset + mainnet-beta             → throw (a money cluster MUST have an
 *                                            explicit, dedicated RPC — never guessed,
 *                                            never devnet)
 */

export const SOLANA_NETWORKS = ['mainnet-beta', 'devnet', 'testnet', 'localnet'] as const;
export type SolanaNetwork = (typeof SOLANA_NETWORKS)[number];

/** Public RPC endpoints per cluster. mainnet-beta has none — it must be explicit. */
const PUBLIC_RPC: Record<SolanaNetwork, string | null> = {
  'mainnet-beta': null,
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
 * alias for `mainnet-beta`. Returns null for unset/blank so the caller can apply
 * the devnet default; throws (via the caller) for a set-but-unknown value.
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
 */
export function resolveNetworkConfig(
  rawNetwork: string | undefined | null,
  explicitRpc: string | undefined | null,
): ResolvedNetworkConfig {
  const normalized = normalizeNetwork(rawNetwork);
  if (normalized === null) {
    if (rawNetwork?.trim()) {
      // Set but unrecognised — always a hard error: a typo'd network must never
      // silently fall back to devnet (or to anything else).
      throw new Error(
        `Invalid SOLANA_NETWORK "${rawNetwork}". Expected one of: ${SOLANA_NETWORKS.join(', ')} (or "mainnet").`,
      );
    }
    // Unset/blank → the historical play-money default (also CI + beta). A deploy
    // that wants mainnet MUST opt in explicitly (and then provide an RPC).
    return resolveWithNetwork('devnet', explicitRpc);
  }
  return resolveWithNetwork(normalized, explicitRpc);
}

function resolveWithNetwork(
  network: SolanaNetwork,
  explicitRpc: string | undefined | null,
): ResolvedNetworkConfig {
  const rpc = explicitRpc?.trim();
  if (rpc) return { network, rpcUrl: rpc };

  // No explicit RPC → derive from the resolved network (NEVER a fixed devnet URL).
  const derived = PUBLIC_RPC[network];
  if (!derived) {
    // mainnet-beta: refuse to guess. The public endpoint is rate-limited and this
    // is a real-money cluster — the operator must provision a dedicated RPC.
    throw new Error(
      `SOLANA_NETWORK=${network} requires an explicit RPC URL (SOLANA_RPC_URL / ` +
        `NEXT_PUBLIC_SOLANA_RPC) — refusing to default a mainnet RPC. Provision a dedicated endpoint.`,
    );
  }
  return { network, rpcUrl: derived };
}
