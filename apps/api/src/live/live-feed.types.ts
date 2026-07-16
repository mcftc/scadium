/**
 * Shared shapes for the sitewide live-bet feed (#roadmap-4). Kept in their own
 * file so the settlement producers (game engines + the instant/stateful shared
 * helpers) depend only on a tiny interface, not the concrete service — no
 * games→live module coupling beyond a type import.
 */

/** What a settlement site hands the feed. Money is BigInt at the boundary. */
export interface SettledBetInput {
  userId: string;
  betId: string;
  gameType: string;
  amountLamports: bigint;
  payoutLamports: bigint;
  /** Null for games without a meaningful multiplier at this row. */
  multiplier: number | null;
  won: boolean;
  /** Epoch ms; defaults to emit time when omitted. */
  at?: number;
}

/**
 * The public, PII-safe event broadcast to every `/live` client + the REST feed.
 * Deliberately minimal: no `userId`, no full wallet, and NO `avatarUrl` — an
 * avatar can be a ~120 KB base64 data-URL, which on an unauthenticated per-bet
 * firehose + public seed endpoint is a bandwidth/memory amplifier. The ticker
 * renders none of it; add it back only as an http(s) URL if ever needed.
 */
export interface LiveBetEvent {
  id: string;
  gameType: string;
  /** Display handle — username, else a shortened wallet. Never the full wallet. */
  player: string;
  amountLamports: string;
  payoutLamports: string;
  multiplier: number | null;
  won: boolean;
  at: number;
}

/**
 * The narrow surface a producer needs. `publishSettledBet` is fire-and-forget:
 * it never throws and never blocks the settlement path (the feed is a
 * best-effort side effect — a broadcast failure must not affect money).
 */
export interface LiveFeedPublisher {
  publishSettledBet(input: SettledBetInput): void;
}
