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

/** The public, PII-safe event broadcast to every `/live` client + the REST feed. */
export interface LiveBetEvent {
  id: string;
  gameType: string;
  /** Display handle — username, else a shortened wallet. Never the full wallet. */
  player: string;
  avatarUrl: string | null;
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
