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
  // Multiplayer table timing
  BETTING_WINDOW_MS: 15_000, // "PLACE YOUR BETS" countdown
  TURN_TIMEOUT_MS: 15_000, // per-seat action timer (timeout = stand)
  SETTLE_PAUSE_MS: 5_000, // result display before the next betting window
  IDLE_ROUNDS_TO_UNSEAT: 3, // sit-outs before a seat is freed
  // Side bet payout multipliers (return = stake × multiplier; outcomes are
  // pure functions of the dealt cards — see @scadium/fair evaluate21Plus3 /
  // evaluatePerfectPairs).
  SIDE_BETS: {
    twentyOnePlusThree: {
      suited_trips: 100,
      straight_flush: 40,
      three_of_a_kind: 30,
      straight: 10,
      flush: 5,
    },
    perfectPairs: {
      perfect: 25,
      colored: 10,
      mixed: 5,
    },
  },
} as const;

/**
 * Demo SOL/USD price. The play-money ledger runs on the SOL balance, so USD
 * prices convert to lamports at this fixed rate. In production this would come
 * from a price oracle.
 */
export const USD_PER_SOL = 150;

/**
 * Demo $SCAD/USD price. The lottery is denominated in $SCAD (the role CAKE
 * plays in PancakeSwap) — ticket price, prize pool, burn and injection are all
 * SCAD. The per-round ticket price targets `LOTTERY.TICKET_PRICE_USD` worth of
 * SCAD at this rate. In production this would come from the SCAD/SOL CPMM or an
 * oracle. At $0.10/SCAD a $1 ticket costs 10 SCAD.
 */
export const USD_PER_SCAD = 0.1;

// ---------- Lottery (PancakeSwap-v2 style: 6-digit, pooled $SCAD prizes) ----------
// A ticket is a 6-digit number, each digit 0..9, matched LEFT-TO-RIGHT in order.
// Six brackets (match-first-1 .. match-first-6); a ticket wins only its highest
// qualifying bracket. The round pool (ticket sales + injection + rollover) is
// split per bracket, an equal share among each bracket's winners; unwon
// brackets roll into the next round. Everything is denominated in $SCAD.
export const LOTTERY = {
  DIGITS: 6, // 6-digit ticket / winning number
  DIGIT_MAX: 10, // each digit is u64 % 10 → 0..9
  BRACKET_COUNT: 6, // match-first-1 .. match-first-6
  TICKET_ENCODING_OFFSET: 1_000_000, // encoded = OFFSET + value (PancakeSwap 1xxxxxx guard)
  // PancakeSwap contract-faithful split: `treasuryFee` is taken off the top
  // (our burn), then `rewardsBreakdown` (which sums to 10000) divides the
  // remaining 80% across brackets. This is mathematically identical to
  // "bracket 1..6 = 1/3/6/10/20/40% of the TOTAL pool + 20% burn".
  TREASURY_FEE_BPS: 2000, // 20% of the pool is burned (PancakeSwap treasuryFee, max 3000)
  REWARDS_BREAKDOWN_BPS: [125, 375, 750, 1250, 2500, 5000] as readonly number[], // sums to 10000
  DISCOUNT_DIVISOR: 2000, // bulk-discount divisor (≈4.95% off at 100 tickets)
  MAX_TICKETS_PER_PURCHASE: 100, // PancakeSwap cap per buy
  TICKET_PRICE_USD: 1, // ticket targets ~$1 of SCAD, set at round start
  SCAD_DECIMALS: 9,
  /** Fixed $SCAD injected into every round's pool (base units, 9 decimals). 1,000 SCAD. */
  INJECTION_SCAD_BASE: 1_000 * 1_000_000_000,
  // No ticket cap of any kind beyond the per-purchase cap (bc.game parity) — the
  // only other limits are the buyer's SCAD balance and per-tx chunking:
  BATCH_TICKETS_PER_TX: 12, // picks per buy_tickets tx (CU headroom; program caps at MAX_TICKETS_PER_TX)
  MAX_TICKETS_PER_TX: 20, // on-chain per-tx cap (raise toward 100 after CU testing)
  MAX_MANUAL_ROWS: 10, // UI: at most 10 editable ticket rows; the rest are auto random
  TICKET_COUNT_PRESETS: [5, 10, 20, 50] as readonly number[],
  // One draw per day at a fixed wall-clock hour. Hours are local
  // (Europe/Istanbul = UTC+3, no DST). See `nextLotteryDrawAt`.
  DRAW_HOURS_LOCAL: [12] as readonly number[],
  DRAW_TZ_OFFSET_MINUTES: 180, // UTC+3
  /** Loyalty: every 1 SOL wagered across ANY game earns 1 free ticket. */
  FREE_TICKET_PER_WAGER_LAMPORTS: LAMPORTS_PER_SOL,
  /**
   * Slots ahead of the current slot to PIN as the draw's `target_slot` at commit
   * (#19b) — a future slot whose hash cannot exist yet, so the cosigner cannot
   * grind the reveal. ~50 slots ≈ 20s at 400ms/slot, mirroring the crash entropy
   * delta. NOTE: the SlotHashes sysvar only retains ~512 recent slots (~3.4 min),
   * so the on-chain commit must run close to the draw — a real daily cadence
   * pins the slot in a pre-draw "seal" step (Phase J deployment concern); the
   * chain layer is decorative today, so this offset is the documented default.
   */
  TARGET_SLOT_OFFSET: 50,
} as const;

export const SWAP = {
  /** Max tolerated buy-and-burn slippage (#31): min_out = expected × (1 − bps/10000). */
  MAX_SLIPPAGE_BPS: 100,
  /** Pool swap fee (bps) — mirrors the on-chain Pool.fee_bps init value. */
  FEE_BPS: 100,
} as const;

/** Prize bracket: 0 = match-first-1 … 5 = match-all-6 (jackpot). */
export type LotteryBracket = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Highest bracket (0..5) a ticket wins given its leading-match count, or `null`
 * for no win. A ticket wins ONLY this single bracket (PancakeSwap semantics).
 */
export function lotteryBracket(matchLen: number): LotteryBracket | null {
  if (matchLen < 1) return null;
  return (Math.min(matchLen, LOTTERY.DIGITS) - 1) as LotteryBracket;
}

/** Per-round ticket price in $SCAD base units (9 decimals) for a USD target. */
export function ticketPriceScadBase(usd = LOTTERY.TICKET_PRICE_USD, usdPerScad = USD_PER_SCAD): bigint {
  return BigInt(Math.round((usd / usdPerScad) * 10 ** LOTTERY.SCAD_DECIMALS));
}

/**
 * SOL-equivalent (lamports) of a $SCAD base-unit amount, via the demo USD
 * rates. Used ONLY for the unified Bet ledger / aggregates — real value moves
 * in $SCAD. Float-based (precision is ample for ledger mirrors).
 */
export function scadBaseToLamports(
  scadBase: bigint,
  usdPerScad = USD_PER_SCAD,
  usdPerSol = USD_PER_SOL,
): bigint {
  const usd = (Number(scadBase) / 10 ** LOTTERY.SCAD_DECIMALS) * usdPerScad;
  return BigInt(Math.round((usd / usdPerSol) * LAMPORTS_PER_SOL));
}

/**
 * PancakeSwap bulk-discount total for `n` tickets (integer base-unit math):
 *   total = price · n · (DISCOUNT_DIVISOR + 1 − n) / DISCOUNT_DIVISOR
 */
export function bulkDiscountTotal(priceBase: bigint, n: number): bigint {
  const d = BigInt(LOTTERY.DISCOUNT_DIVISOR);
  return (priceBase * BigInt(n) * (d + 1n - BigInt(n))) / d;
}

/**
 * Split a round's total SCAD pool into the burn slice and the six bracket
 * slices, faithfully to the PancakeSwap contract: burn `treasuryFee` off the
 * top, then divide the remainder by `rewardsBreakdown` (sums to 10000). A
 * bracket slice with no winners is the caller's responsibility to roll forward.
 */
export function lotteryPoolSplit(totalPool: bigint): { brackets: bigint[]; burn: bigint } {
  const burn = (totalPool * BigInt(LOTTERY.TREASURY_FEE_BPS)) / 10_000n;
  const toWinners = totalPool - burn;
  const brackets = LOTTERY.REWARDS_BREAKDOWN_BPS.map(
    (bps) => (toWinners * BigInt(bps)) / 10_000n,
  );
  return { brackets, burn };
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
