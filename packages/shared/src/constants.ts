/**
 * Shared constants for Scadium platform.
 * Game rules, limits, and payout structures.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

// ---------- Game types ----------
export const GAME_TYPES = ['crash', 'coinflip', 'blackjack', 'lottery', 'jackpot'] as const;
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
  BET_WINDOW_MS: 20_000, // 20s betting window between rounds
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

/**
 * Demo SOL/USD price. The lottery is priced in USDT but the play-money ledger
 * runs on the SOL balance, so USDT prices convert to lamports at this fixed
 * rate. In production this would come from a price oracle.
 */
export const USD_PER_SOL = 150;

// ---------- Lottery (5 of 36 + 1 of 10, provably fair) ----------
export const LOTTERY = {
  MAIN_COUNT: 5, // pick 5 main numbers
  MAIN_MAX: 36, // from 1..36
  BONUS_COUNT: 1, // plus 1 bonus ("power") number
  BONUS_MAX: 10, // from 1..10
  TICKET_PRICE_USD: 0.1, // $0.10 USDT per ticket (canonical price)
  // Ledger debits/credits run on the SOL play-money balance, so the lamport
  // cost is derived from the USD price at the fixed demo rate above.
  TICKET_PRICE_LAMPORTS: Math.round((0.1 / USD_PER_SOL) * LAMPORTS_PER_SOL),
  MAX_TICKETS_PER_DRAW: 50, // per user, per draw
  // Draws resolve at fixed wall-clock times — 04:00 and 16:00 every day, i.e.
  // once every 12 hours. Hours are expressed in local time and converted to
  // UTC via the offset below (Europe/Istanbul = UTC+3, no DST, so a fixed
  // offset is exact). See `nextLotteryDrawAt`.
  DRAW_HOURS_LOCAL: [4, 16] as readonly number[],
  DRAW_TZ_OFFSET_MINUTES: 180, // UTC+3
  HOUSE_EDGE: 0.05,
  /**
   * Fixed-odds prize table keyed by `${matchedMain}+${matchedBonus}`.
   * Payout = TICKET_PRICE_LAMPORTS * multiplier. Tiers not listed pay 0.
   */
  PRIZES: {
    '5+1': 1_000_000, // jackpot
    '5+0': 50_000,
    '4+1': 5_000,
    '4+0': 400,
    '3+1': 150,
    '3+0': 20,
    '2+1': 8,
    '2+0': 2,
    '1+1': 3,
    '0+1': 1, // bonus-only — returns the stake
  } as Record<string, number>,
} as const;

/** Fixed-odds payout multiplier for a lottery ticket given its match counts. */
export function lotteryPrizeMultiplier(matchedMain: number, matchedBonus: number): number {
  return LOTTERY.PRIZES[`${matchedMain}+${matchedBonus}`] ?? 0;
}

/**
 * Epoch ms of the next lottery draw at or after `nowMs`, snapped to the fixed
 * local draw hours (`LOTTERY.DRAW_HOURS_LOCAL`). The returned time is strictly
 * in the future relative to `nowMs`, so calling it right after a draw settles
 * yields the *following* slot.
 */
export function nextLotteryDrawAt(nowMs: number): number {
  const offsetMs = LOTTERY.DRAW_TZ_OFFSET_MINUTES * 60 * 1000;
  // Shift into "local" space so UTC getters read the local wall clock.
  const local = nowMs + offsetMs;
  const d = new Date(local);
  const localDayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const hours = [...LOTTERY.DRAW_HOURS_LOCAL].sort((a, b) => a - b);
  // Candidate slots today and tomorrow guarantee one lands strictly after now.
  const candidates = [
    ...hours.map((h) => localDayStart + h * 3_600_000),
    ...hours.map((h) => localDayStart + 24 * 3_600_000 + h * 3_600_000),
  ];
  const nextLocal = candidates.find((t) => t > local)!;
  return nextLocal - offsetMs;
}

// ---------- Jackpot (provably-fair pot raffle) ----------
export const JACKPOT = {
  MIN_ENTRY_LAMPORTS: 10_000_000, // 0.01 SOL minimum entry
  MAX_ENTRY_LAMPORTS: 50 * LAMPORTS_PER_SOL, // 50 SOL max per entry
  ROUND_WINDOW_MS: 45_000, // 45s open window per round
  MIN_PLAYERS: 2, // need 2+ distinct players to draw; else refund
  HOUSE_EDGE: 0.05, // winner takes 95% of the pot
} as const;

// ---------- Rewards ----------
export const REWARDS = {
  AIRDROP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
  AIRDROP_MIN_WAGER_LAMPORTS: 1_000_000, // 0.001 SOL
  AIRDROP_REQUIRES_CHAT: true,
  DAILY_CASE_INTERVAL_MS: 24 * 60 * 60 * 1000,
  SCADIUM_PER_SOL_WAGERED: 128,
} as const;

// ---------- $SCAD token (whitepaper-modeled) ----------
// All SCAD amounts in code are BASE UNITS (9 decimals) unless noted.
// Conversions stay lamport-friendly: 1 SOL wagered (1e9 lamports) earns
// 128 SCAD (128e9 base units) → base units = lamports × PER_LAMPORT rates.
export const SCAD = {
  DECIMALS: 9,
  TOTAL_SUPPLY: 217_755_972, // whole tokens
  ALLOC_TEAM: 0.1,
  ALLOC_REWARDS: 0.4,
  ALLOC_USERS: 0.5,
  /** SCAD base units earned per lamport wagered (= 128 SCAD / SOL). */
  WAGER_REWARD_PER_LAMPORT: 128,
  /** SCAD base units of cashback per lamport NET lost (= 32 SCAD / SOL). */
  CASHBACK_PER_LAMPORT_LOST: 32,
  /** Daily case prize table — SCAD base units, weighted roll. */
  CASE_TIERS: [
    { tier: 'legendary', chance: 0.001, scadBase: 100_000_000_000_000 }, // 100k SCAD
    { tier: 'epic', chance: 0.01, scadBase: 10_000_000_000_000 }, // 10k
    { tier: 'rare', chance: 0.1, scadBase: 1_000_000_000_000 }, // 1k
    { tier: 'common', chance: 1, scadBase: 100_000_000_000 }, // 100
  ],
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
