/**
 * Shared constants for Scadium platform.
 * Game rules, limits, and payout structures.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

// ---------- Game types ----------
export const GAME_TYPES = ['crash', 'coinflip', 'blackjack'] as const;
export type GameType = (typeof GAME_TYPES)[number];

// ---------- Coinflip ----------
export const COINFLIP = {
  MIN_BET_LAMPORTS: 1_000_000, // 0.001 SOL
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL, // 100 SOL
  PAYOUT_MULTIPLIER: 1.9,
  HOUSE_EDGE: 0.05,
  SIDES: ['heads', 'tails'] as const,
} as const;

export type CoinflipSide = (typeof COINFLIP.SIDES)[number];

// ---------- Crash ----------
export const CRASH = {
  MIN_BET_LAMPORTS: 1_000_000,
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL,
  MIN_CASHOUT_MULTIPLIER: 1.01,
  MAX_CASHOUT_MULTIPLIER: 1_000_000,
  BET_WINDOW_MS: 6_000,
  TICK_RATE_HZ: 20,
  GROWTH_RATE: 1.0024, // m(t_ms) = GROWTH_RATE ^ (t_ms / 10)
  INSTANT_BUST_CHANCE: 1 / 20, // matches solpump formula (h % 20 === 0)
  HOUSE_EDGE: 0.05,
} as const;

// ---------- Blackjack ----------
export const BLACKJACK = {
  MIN_BET_LAMPORTS: 1_000_000,
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL,
  NATURAL_PAYOUT: 1.5, // 3:2
  INSURANCE_PAYOUT: 2, // 2:1
  DEALER_HITS_SOFT_17: true,
  MAX_SEATS: 5,
  DECK_COUNT: Infinity, // infinite deck model
  ALLOW_SURRENDER: false,
  ALLOW_DOUBLE_AFTER_SPLIT: true,
  MAX_SPLIT_HANDS: 4,
} as const;

// ---------- Rewards ----------
export const REWARDS = {
  AIRDROP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
  AIRDROP_MIN_WAGER_LAMPORTS: 1_000_000, // 0.001 SOL
  AIRDROP_REQUIRES_CHAT: true,
  DAILY_CASE_INTERVAL_MS: 24 * 60 * 60 * 1000,
  SCADIUM_PER_SOL_WAGERED: 128,
} as const;

// ---------- Affiliate ----------
export const AFFILIATE = {
  TIER_THRESHOLDS_LAMPORTS: [
    0, // tier 0
    10 * LAMPORTS_PER_SOL,
    100 * LAMPORTS_PER_SOL,
    1_000 * LAMPORTS_PER_SOL,
  ],
  TIER_COMMISSION: [0.05, 0.08, 0.12, 0.15] as const,
} as const;

// ---------- Chat ----------
export const CHAT = {
  MESSAGE_MAX_LEN: 500,
  RATE_LIMIT_WINDOW_MS: 5_000,
  RATE_LIMIT_MESSAGES: 5,
} as const;

// ---------- Geo blocklist ----------
export const BLOCKED_COUNTRIES = ['US', 'GB', 'FR', 'DE', 'ES', 'NL'] as const;
