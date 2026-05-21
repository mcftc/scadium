"use strict";
/**
 * Shared constants for Scadium platform.
 * Game rules, limits, and payout structures.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKED_COUNTRIES = exports.CHAT = exports.AFFILIATE = exports.REWARDS = exports.BLACKJACK = exports.CRASH = exports.COINFLIP = exports.GAME_TYPES = exports.LAMPORTS_PER_SOL = void 0;
exports.LAMPORTS_PER_SOL = 1_000_000_000;
// ---------- Game types ----------
exports.GAME_TYPES = ['crash', 'coinflip', 'blackjack'];
// ---------- Coinflip ----------
exports.COINFLIP = {
    MIN_BET_LAMPORTS: 1_000_000, // 0.001 SOL
    MAX_BET_LAMPORTS: 100 * exports.LAMPORTS_PER_SOL, // 100 SOL
    PAYOUT_MULTIPLIER: 1.9,
    HOUSE_EDGE: 0.05,
    SIDES: ['heads', 'tails'],
};
// ---------- Crash ----------
exports.CRASH = {
    MIN_BET_LAMPORTS: 1_000_000,
    MAX_BET_LAMPORTS: 100 * exports.LAMPORTS_PER_SOL,
    MIN_CASHOUT_MULTIPLIER: 1.01,
    MAX_CASHOUT_MULTIPLIER: 1_000_000,
    BET_WINDOW_MS: 6_000,
    TICK_RATE_HZ: 20,
    GROWTH_RATE: 1.0024, // m(t_ms) = GROWTH_RATE ^ (t_ms / 10)
    INSTANT_BUST_CHANCE: 1 / 20, // matches solpump formula (h % 20 === 0)
    HOUSE_EDGE: 0.05,
};
// ---------- Blackjack ----------
exports.BLACKJACK = {
    MIN_BET_LAMPORTS: 1_000_000,
    MAX_BET_LAMPORTS: 100 * exports.LAMPORTS_PER_SOL,
    NATURAL_PAYOUT: 1.5, // 3:2
    INSURANCE_PAYOUT: 2, // 2:1
    DEALER_HITS_SOFT_17: true,
    MAX_SEATS: 5,
    DECK_COUNT: Infinity, // infinite deck model
    ALLOW_SURRENDER: false,
    ALLOW_DOUBLE_AFTER_SPLIT: true,
    MAX_SPLIT_HANDS: 4,
};
// ---------- Rewards ----------
exports.REWARDS = {
    AIRDROP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
    AIRDROP_MIN_WAGER_LAMPORTS: 1_000_000, // 0.001 SOL
    AIRDROP_REQUIRES_CHAT: true,
    DAILY_CASE_INTERVAL_MS: 24 * 60 * 60 * 1000,
    SCADIUM_PER_SOL_WAGERED: 128,
};
// ---------- Affiliate ----------
exports.AFFILIATE = {
    TIER_THRESHOLDS_LAMPORTS: [
        0, // tier 0
        10 * exports.LAMPORTS_PER_SOL,
        100 * exports.LAMPORTS_PER_SOL,
        1_000 * exports.LAMPORTS_PER_SOL,
    ],
    TIER_COMMISSION: [0.05, 0.08, 0.12, 0.15],
};
// ---------- Chat ----------
exports.CHAT = {
    MESSAGE_MAX_LEN: 500,
    RATE_LIMIT_WINDOW_MS: 5_000,
    RATE_LIMIT_MESSAGES: 5,
};
// ---------- Geo blocklist ----------
exports.BLOCKED_COUNTRIES = ['US', 'GB', 'FR', 'DE', 'ES', 'NL'];
//# sourceMappingURL=constants.js.map