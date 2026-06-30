/**
 * Shared constants for Scadium platform.
 * Game rules, limits, and payout structures.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

// ---------- House edge / RTP (single source of truth) ----------
// Every house-banked game targets the SAME return-to-player. Each game's
// `HOUSE_EDGE` points here so standardising the hold is a one-line change, and
// the payout helpers / scaled tables below all derive their EV from `RTP`.
// EXEMPT: lottery (pari-mutuel pool/burn model, no per-bet RTP) and blackjack
// (RTP is emergent from the rule set — dealer hits soft 17, 3:2 naturals, side
// bets — and can't be a flat scalar without distorting the rules).
export const HOUSE_EDGE = 0.05; // 5% hold
export const RTP = 1 - HOUSE_EDGE; // 0.95 return-to-player

// ---------- Game types ----------
export const GAME_TYPES = ['crash', 'coinflip', 'blackjack', 'lottery', 'jackpot'] as const;
export type GameType = (typeof GAME_TYPES)[number];

// ---------- Coinflip ----------
export const COINFLIP = {
  MIN_BET_LAMPORTS: 1_000_000, // 0.001 SOL
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL, // 100 SOL
  // Even-money flip pays 2× the stake minus the house edge, taken upfront:
  // 2 × RTP = 1.9× on a win (house take = pot − 1.9×stake).
  PAYOUT_MULTIPLIER: Math.round(2 * RTP * 100) / 100,
  HOUSE_EDGE,
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
  INSTANT_BUST_CHANCE: 1 / 20, // matches solpump formula (h % 20 === 0) = 5% hold
  HOUSE_EDGE, // structural: the h%20 instant-bust IS the 5% edge (see crash.ts)
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
  /** Worst-case return per lamport staked at a seat (#30) — dominated by the
   * 21+3 suited-trips side bet (100×); the main bet's worst case (4 split
   * hands, each doubled and won: 16×) sits below it. The house exposure guard
   * reserves betTotal × this at bet acceptance. */
  MAX_PAYOUT_X: 100,
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

/**
 * House bankroll risk model (#30) — see docs/bankroll-model.md. The vault
 * program reserves the house vault's rent floor on-chain; these knobs bound
 * what the API will EXPOSE per bet/round once settlement is funded.
 */
export const HOUSE = {
  /** Absolute cap on a single bet's payout — the bankroll-sizing anchor.
   * (CRASH alone allows 100 SOL × 1,000,000× uncapped — no bankroll covers
   * that; real books cap the WIN, not the multiplier.) */
  MAX_WIN_PER_BET_LAMPORTS: 50 * LAMPORTS_PER_SOL,
  /** Per betting round: Σ potential payouts ≤ this fraction of the live house
   * vault balance (basis points). */
  MAX_ROUND_EXPOSURE_BPS: 2_000, // 20%
  /** Alert threshold: house vault below rent floor + this buffer. */
  MIN_BANKROLL_BUFFER_LAMPORTS: 1 * LAMPORTS_PER_SOL,
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
export function ticketPriceScadBase(
  usd = LOTTERY.TICKET_PRICE_USD,
  usdPerScad = USD_PER_SCAD,
): bigint {
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
  const brackets = LOTTERY.REWARDS_BREAKDOWN_BPS.map((bps) => (toWinners * BigInt(bps)) / 10_000n);
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

// ---------- $SCAD token (finalized tokenomics) ----------
// All SCAD amounts in code are BASE UNITS (9 decimals) unless noted.
// Conversions stay lamport-friendly: 1 SOL wagered (1e9 lamports) earns
// 128 SCAD (128e9 base units) at phase 1 → base units = lamports × PER_LAMPORT.
//
// Fixed max supply 1,000,000,000 (1B) $SCAD, distributed:
//   Play-to-Earn 50% (500M) · Community/Airdrop 10% (100M) · Liquidity 10%
//   (100M) · Treasury/Ecosystem/MM 15% (150M) · Team 10% (100M) · Strategic
//   5% (50M). The 500M P2E pool is emitted by proof-of-wager HALVING: the
//   per-SOL-wagered rate halves each time emission crosses a phase pool cap
//   (128→64→32→16→8→4→2), the seven pools sizing 75/75/75/75/75/75/50M SCAD
//   (cumulative 75/150/225/300/375/450/500M).
export const SCAD = {
  DECIMALS: 9,
  TOTAL_SUPPLY: 1_000_000_000, // whole tokens (fixed max supply)
  // 6-way distribution (fractions of TOTAL_SUPPLY; sum = 1.0).
  ALLOC_P2E: 0.5, // Play-to-Earn emission pool (500M)
  ALLOC_COMMUNITY: 0.1, // Community / Airdrop (100M)
  ALLOC_LIQUIDITY: 0.1, // Liquidity (100M)
  ALLOC_TREASURY: 0.15, // Treasury / Ecosystem / MM (150M)
  ALLOC_TEAM: 0.1, // Team (100M)
  ALLOC_STRATEGIC: 0.05, // Strategic (50M)
  /**
   * SCAD base units earned per lamport wagered at PHASE 1 (= 128 SCAD / SOL).
   * Halving phases below override this once emission crosses a phase cap; kept
   * as the phase-1 alias so legacy call sites read the opening rate. Always
   * equals `EMISSION_PHASES[0].ratePerLamport`.
   */
  WAGER_REWARD_PER_LAMPORT: 128,
  /** SCAD base units of cashback per lamport NET lost (= 32 SCAD / SOL). */
  CASHBACK_PER_LAMPORT_LOST: 32,
  /**
   * Play-to-Earn emission pool, in SCAD BASE units (500M × 1e9). The total
   * $SCAD that proof-of-wager may ever mint; `accrue()` clamps cumulative
   * emission to this and stops minting once it is exhausted.
   */
  P2E_POOL_BASE: 500_000_000n * 1_000_000_000n, // 500M × 1e9 = 5e17
  /**
   * Halving schedule for the P2E pool. Ordered by ascending cumulative cap.
   * `ratePerLamport` is the SCAD base units minted per lamport wagered while
   * cumulative emission sits below `cumulativeCapBase` (SCAD base units). The
   * active phase is the FIRST whose cap strictly exceeds current cumulative
   * emission. Pools: 75/75/75/75/75/75/50M (cumulative 75/150/…/500M).
   */
  EMISSION_PHASES: [
    { ratePerLamport: 128, cumulativeCapBase: 75_000_000n * 1_000_000_000n },
    { ratePerLamport: 64, cumulativeCapBase: 150_000_000n * 1_000_000_000n },
    { ratePerLamport: 32, cumulativeCapBase: 225_000_000n * 1_000_000_000n },
    { ratePerLamport: 16, cumulativeCapBase: 300_000_000n * 1_000_000_000n },
    { ratePerLamport: 8, cumulativeCapBase: 375_000_000n * 1_000_000_000n },
    { ratePerLamport: 4, cumulativeCapBase: 450_000_000n * 1_000_000_000n },
    { ratePerLamport: 2, cumulativeCapBase: 500_000_000n * 1_000_000_000n },
  ],
  /** Daily case prize table — SCAD base units, weighted roll. */
  CASE_TIERS: [
    { tier: 'legendary', chance: 0.001, scadBase: 100_000_000_000_000 }, // 100k SCAD
    { tier: 'epic', chance: 0.01, scadBase: 10_000_000_000_000 }, // 10k
    { tier: 'rare', chance: 0.1, scadBase: 1_000_000_000_000 }, // 1k
    { tier: 'common', chance: 1, scadBase: 100_000_000_000 }, // 100
  ],
} as const;

/**
 * Resolve the active emission phase for a cumulative-emitted total (SCAD base
 * units). Returns the 1-based phase index, the rate per lamport, and the SCAD
 * base units remaining until the next halving (0 once the pool is exhausted).
 * The active phase is the FIRST whose cap strictly exceeds `totalEmittedBase`;
 * when emission has reached the final cap, the last phase is returned with a
 * zero `toNextHalvingBase`.
 */
export function emissionPhaseFor(totalEmittedBase: bigint): {
  phase: number; // 1..EMISSION_PHASES.length
  ratePerLamport: number;
  toNextHalvingBase: bigint;
} {
  const phases = SCAD.EMISSION_PHASES;
  for (let i = 0; i < phases.length; i += 1) {
    const p = phases[i]!;
    if (totalEmittedBase < p.cumulativeCapBase) {
      const toNext = p.cumulativeCapBase - totalEmittedBase;
      return { phase: i + 1, ratePerLamport: p.ratePerLamport, toNextHalvingBase: toNext };
    }
  }
  // Pool exhausted (or beyond final cap): pin to the final phase, nothing left.
  const last = phases[phases.length - 1]!;
  return { phase: phases.length, ratePerLamport: last.ratePerLamport, toNextHalvingBase: 0n };
}

// ---------- Jeton (bought, NON-redeemable wagering currency) ----------
// Jeton shares the lamport unit of `User.playBalanceLamports`. It is a CLOSED
// virtual currency, so we peg it to USD with a FIXED internal rate (independent
// of the live SOL price) — this keeps purchase pricing and the holding cap
// consistent. Tune `LAMPORTS_PER_USD` to set how much Jeton a dollar buys.
export const JETON = {
  /** Jeton lamports credited per USD paid. Default: $1 = 0.01 SOL-equivalent. */
  LAMPORTS_PER_USD: 10_000_000,
  /**
   * Max Jeton a user may HOLD at once (= $100). Enforced at credit time via the
   * `maxBalance` guard in applyBalanceDelta; wagering only ever reduces Jeton.
   * App-store / card rails may sell Jeton up to this cap; Jeton is never
   * redeemable for value (only $SCAD is).
   */
  MAX_HOLDING_LAMPORTS: 100 * 10_000_000, // $100 → 1 SOL-equivalent
  /** Default purchasable Jeton packages, priced in USD cents. */
  PACKAGES: [
    { id: 'starter', usdCents: 500, label: '$5' },
    { id: 'plus', usdCents: 2000, label: '$20' },
    { id: 'pro', usdCents: 5000, label: '$50' },
    { id: 'max', usdCents: 10000, label: '$100' },
  ],
} as const;

// ---------- Proof-of-Wager ($SCAD accrual + campaigns) ----------
// $SCAD earned per lamport wagered uses SCAD.WAGER_REWARD_PER_LAMPORT (128).
// Campaigns layer a MULTIPLIER on top of that base accrual; lifetime-wager tiers
// give loyal players a permanent boost. Both are applied by ProofOfWagerService.
export const WAGER = {
  /** Lifetime-wager (lamports) → permanent accrual multiplier. Ascending. */
  TIER_THRESHOLDS_LAMPORTS: [
    0, // tier 0 — base
    10 * LAMPORTS_PER_SOL,
    100 * LAMPORTS_PER_SOL,
    1_000 * LAMPORTS_PER_SOL,
  ],
  TIER_MULTIPLIER: [1.0, 1.1, 1.25, 1.5] as const,
  /** Hard ceiling on the combined (tier × campaign) multiplier — anti-abuse. */
  MAX_MULTIPLIER: 5.0,
} as const;

// ---------- USDS (USD-pegged dividend stablecoin) ----------
// USDS is the SCAD Engine's PAYOUT currency — the analog of bc.game's BCD. It is
// distributed to $SCAD stakers from casino profit (see ENGINE below) and is the
// only USD-denominated unit in the system. SPL on Solana (6 decimals, USDC
// convention). All USDS amounts in code are BASE UNITS (6 decimals) unless noted.
export const USDS = {
  DECIMALS: 6,
  /** USDS base units per whole USD (1 USDS = $1). */
  BASE_PER_USD: 1_000_000,
} as const;

// ---------- SCAD Engine (staking + GGR dividends) ----------
// bc.game's "engine" adapted: earned $SCAD is staked, and a share of casino Net
// Gaming Revenue (NGR = wagered − paid out) is paid HOURLY to stakers, pro-rata
// to their staked balance, in USDS. Staking auto-engages on reward claim and is
// time-locked. There is NO buy-and-burn — $SCAD is a pure Proof-of-Play mining
// token; the entire staker slice is paid to holders (no deflationary burn).
export const ENGINE = {
  /**
   * Share of NGR routed to the (liquid) Engine staker dividend pool, in bps
   * (= 12%). Absorbed the former buy-and-burn slice when buy-and-burn was removed
   * (6% dividend + 6% buyback → 12% dividend). Total redistribution stays ≤ 20% —
   * see `VAULT` / `ngrRedistributionBps`.
   */
  DIVIDEND_NGR_BPS: 1200,
  /**
   * Buy-and-burn is REMOVED (= 0). $SCAD has no deflationary burn — it is a pure
   * mining token. Kept at 0 (not deleted) so `buybackBudgetLamports` /
   * `ngrRedistributionBps` and their callers resolve to a clean no-op.
   */
  BUYBACK_NGR_BPS: 0,
  /** Distribution round cadence — one round per hour. */
  DISTRIBUTION_INTERVAL_MS: 60 * 60 * 1000,
  /**
   * @deprecated The Engine is now LIQUID — staking does not lock and unstake is
   * instant. Retained only so legacy references resolve; the time-locked,
   * term-based product is the SCAD Vault (see `VAULT.TERMS`). Not enforced.
   */
  LOCK_PERIOD_MS: 0,
  /** Minimum $SCAD base units that may be staked in one call (anti-dust). */
  MIN_STAKE_SCAD_BASE: 1_000_000_000, // 1 SCAD
  /** Skip a distribution round whose USDS pool is below this (anti-dust). */
  MIN_DIVIDEND_POOL_USDS_BASE: 1_000, // $0.001
  /** Auto-stake earned $SCAD on reward claim by default (bc.game parity). */
  AUTO_STAKE_DEFAULT: true,

  // ---- Proof-of-Play mining (Engine v2) ----
  /**
   * Hourly $SCAD "block reward" at halving PHASE 1, in SCAD base units
   * (10k SCAD/hour). Halves each phase via `blockRewardFor` (10k → 5k → … like
   * the 128→2 rate schedule), so the 500M P2E pool drains over a long, Bitcoin-
   * style tail. The block is split across the hour's miners by play-rate share.
   */
  BLOCK_REWARD_PHASE1_BASE: 10_000n * 1_000_000_000n,
  /** Slice of each hourly block routed to the weighted-random big-reward draw (bps). */
  BIG_REWARD_BPS: 1_000, // 10%
  /**
   * Staking → passive play-rate: a staker's `scadiumStaked` (SCAD base units)
   * contributes this bps of itself as lamport-equivalent play-rate each hour, so
   * "$SCAD savers" keep mining without actively playing (continuity). Tuned low
   * so active play still dominates. 1% → 1000 staked SCAD ≈ 0.01 SOL-equiv/hr.
   */
  STAKE_PLAYRATE_BPS: 100,
} as const;

/**
 * Hourly block reward (SCAD base units) for the current halving phase, halved
 * once per phase from `BLOCK_REWARD_PHASE1_BASE` and clamped to what's left of
 * the P2E pool. Returns 0n once the pool is exhausted.
 */
export function blockRewardFor(totalEmittedBase: bigint): bigint {
  const remaining = SCAD.P2E_POOL_BASE - totalEmittedBase;
  if (remaining <= 0n) return 0n;
  const { phase } = emissionPhaseFor(totalEmittedBase);
  const reward = ENGINE.BLOCK_REWARD_PHASE1_BASE >> BigInt(phase - 1); // halve per phase
  return reward < remaining ? reward : remaining;
}

// ---------- Year-based emission (4-year halving, Bitcoin-style) ----------
// $SCAD is mined in hourly blocks whose subsidy HALVES every 4 years. Era 0
// (years 0–4) emits HALF the 500M P2E pool; each era halves, so the pool drains
// over a long Bitcoin-style tail. The halving is TIME-based (not pool-cap): it
// advances with the calendar, independent of play volume. This is the active
// emission authority (`emissionPhaseFor`/`blockRewardFor` are legacy, retained
// only for the vestigial per-SOL earn-rate readout).
export const MINING = {
  /** Mining genesis (UTC) — era / halving are measured from here. */
  GENESIS_MS: Date.UTC(2026, 6, 1), // 2026-07-01
  /** Halving period: 4 years. */
  YEARS_PER_HALVING: 4,
  HOURS_PER_HALVING: 4 * 365 * 24, // 35,040
  MS_PER_HALVING: 4 * 365 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Era-0 hourly block subsidy (SCAD base units): half the P2E pool spread evenly
 * across the first 4-year era. Each subsequent era halves it, so the geometric
 * sum (½ + ¼ + …) drains the whole pool. ≈ 7,134 $SCAD / hour at launch.
 */
export const GENESIS_BLOCK_REWARD_BASE = SCAD.P2E_POOL_BASE / 2n / BigInt(MINING.HOURS_PER_HALVING);

/** Halving era index for a timestamp: 0 before/at genesis, +1 every 4 years. */
export function emissionEraAt(nowMs: number): number {
  const elapsed = nowMs - MINING.GENESIS_MS;
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / MINING.MS_PER_HALVING);
}

/**
 * The hourly block subsidy at `nowMs` under the 4-year halving, clamped to the
 * P2E pool remaining after `totalEmittedBase`. Returns 0n once the pool is
 * exhausted. This is what `BlockMiningService` mints each hour.
 */
export function blockRewardAt(nowMs: number, totalEmittedBase: bigint): bigint {
  const remaining = SCAD.P2E_POOL_BASE - totalEmittedBase;
  if (remaining <= 0n) return 0n;
  const reward = GENESIS_BLOCK_REWARD_BASE >> BigInt(emissionEraAt(nowMs));
  return reward < remaining ? reward : remaining;
}

/** ms until the next 4-year halving from `nowMs`. */
export function msToNextHalving(nowMs: number): number {
  const era = emissionEraAt(nowMs);
  const nextAt = MINING.GENESIS_MS + (era + 1) * MINING.MS_PER_HALVING;
  return Math.max(0, nextAt - nowMs);
}

/**
 * A player's active play-rate for an hour: lamports wagered scaled by their tier
 * multiplier (integer milli — 1000 = 1.0×). Play-rate is the "hashrate" the
 * hourly block is split by.
 */
export function activePlayRate(wageredLamports: bigint, tierMultMilli = 1000): bigint {
  if (wageredLamports <= 0n) return 0n;
  return (wageredLamports * BigInt(tierMultMilli)) / 1000n;
}

/** Passive play-rate (lamport-equiv) contributed by a staked $SCAD balance. */
export function stakePlayRate(stakedScadBase: bigint): bigint {
  if (stakedScadBase <= 0n) return 0n;
  return (stakedScadBase * BigInt(ENGINE.STAKE_PLAYRATE_BPS)) / 10_000n;
}

/**
 * One miner's pro-rata cut of a block reward, floored (dust stays in the pool /
 * rolls to the next block). BigInt-safe.
 */
export function blockShare(playRate: bigint, totalPlayRate: bigint, reward: bigint): bigint {
  if (playRate <= 0n || totalPlayRate <= 0n || reward <= 0n) return 0n;
  return (reward * playRate) / totalPlayRate;
}

/**
 * Convert a lamport-denominated NGR figure to USDS base units at the fixed
 * internal Jeton rate (games are wagered in Jeton, so NGR is in Jeton lamports).
 * USD = lamports / JETON.LAMPORTS_PER_USD; USDS base = USD × USDS.BASE_PER_USD.
 * Integer math throughout (BigInt-safe) — no float drift on money.
 */
export function lamportsToUsdsBase(lamports: bigint): bigint {
  if (lamports <= 0n) return 0n;
  return (lamports * BigInt(USDS.BASE_PER_USD)) / BigInt(JETON.LAMPORTS_PER_USD);
}

/** NGR (lamports) → USDS dividend pool (base units), applying DIVIDEND_NGR_BPS. */
export function dividendPoolUsdsBase(ngrLamports: bigint): bigint {
  if (ngrLamports <= 0n) return 0n;
  const slice = (ngrLamports * BigInt(ENGINE.DIVIDEND_NGR_BPS)) / 10_000n;
  return lamportsToUsdsBase(slice);
}

/** NGR (lamports) → buy-and-burn budget (lamports), applying BUYBACK_NGR_BPS. */
export function buybackBudgetLamports(ngrLamports: bigint): bigint {
  if (ngrLamports <= 0n) return 0n;
  return (ngrLamports * BigInt(ENGINE.BUYBACK_NGR_BPS)) / 10_000n;
}

// ---------- SCAD Vault (term staking — "vadeli mevduat") ----------
// The Vault complements the (liquid) Engine: users lock $SCAD for a chosen TERM
// into one of several pools; longer terms get a larger share of the Vault yield
// slice (higher effective APR). Early withdrawal is allowed but charged
// EARLY_EXIT_PENALTY_BPS, which stays in the pool (raising the index) to reward
// stakers who hold to maturity. Accounting is share/index based (ERC-4626-style):
// a pool tracks an `indexRay` (share price); yield raises the index, so every
// position appreciates pro-rata in O(1). All $SCAD amounts are BASE units (9 dp).
export const VAULT = {
  /** Faz 1 vault asset — denominated in $SCAD. */
  ASSET: 'scad',
  /** Fixed-point scalar for the share price index ("ray", 1e18). */
  RAY: 1_000_000_000_000_000_000n,
  /** Share price at pool genesis: 1 share = 1 asset. */
  INITIAL_INDEX_RAY: 1_000_000_000_000_000_000n,
  /** Share of NGR routed to the Vault yield pool, in bps (= 8%). */
  YIELD_NGR_BPS: 800,
  /** Penalty on early (pre-maturity) withdrawal, in bps of withdrawn assets (= 10%). */
  EARLY_EXIT_PENALTY_BPS: 1000,
  /** Minimum $SCAD base units per deposit (anti-dust). 1 SCAD. */
  MIN_DEPOSIT_SCAD_BASE: 1_000_000_000,
  /** Skip an accrual round whose total $SCAD yield is below this (anti-dust). */
  MIN_ACCRUAL_SCAD_BASE: 1_000_000,
  /**
   * Term pools (one pool per term). `weightBps` is the RELATIVE weight used to
   * split the Vault yield slice across pools (longer term → larger weight →
   * higher effective APR). Weights are relative — they need not sum to 10000.
   */
  TERMS: [
    { days: 30, weightBps: 1000 },
    { days: 90, weightBps: 2000 },
    { days: 180, weightBps: 3000 },
    { days: 365, weightBps: 4000 },
  ],
  /**
   * Loyalty APR boost tiers (V13). The more $SCAD a user holds, the higher their
   * effective APR — a SCAD-denominated multiplier applied to a pool's base APR.
   * `minScadBase` is the holdings threshold in $SCAD base units (9 dp);
   * `multiplierBps` scales the base APR (10000 = 1.00×, 20000 = 2.00×). Tiers
   * are sorted ascending by threshold; a user earns the HIGHEST tier whose
   * threshold they meet. Single source of truth so the on-chain V11 liquid-
   * staking layer can mirror the schedule bit-for-bit.
   */
  BOOST_TIERS: [
    { minScadBase: 0n, multiplierBps: 10_000, label: 'Base' },
    { minScadBase: 10_000_000_000_000n, multiplierBps: 11_000, label: 'Bronze' }, // 10k SCAD → 1.10×
    { minScadBase: 50_000_000_000_000n, multiplierBps: 12_500, label: 'Silver' }, // 50k SCAD → 1.25×
    { minScadBase: 250_000_000_000_000n, multiplierBps: 15_000, label: 'Gold' }, // 250k SCAD → 1.50×
    { minScadBase: 1_000_000_000_000_000n, multiplierBps: 20_000, label: 'Diamond' }, // 1M SCAD → 2.00×
  ],
  /**
   * Faz 3 real-DeFi strategy parameters (V11 jitoSOL / V12 Kamino — see
   * `docs/runbooks/vault-faz3-defi-design.md`). A pool keeps `BUFFER_BPS` of its
   * assets liquid for instant withdrawals and may deploy the rest into a yield
   * strategy, never exceeding `MAX_INVESTED_BPS`. When liquid falls below
   * `BUFFER_FLOOR_BPS` the strategy is divested back to the buffer target.
   * Off-chain-first: these drive `VaultStrategyService`'s planning today and the
   * on-chain `vault_invest`/`vault_divest`/`vault_harvest` CPIs once deployed.
   */
  STRATEGY: {
    /** Target liquid fraction kept for instant withdrawals (15%). */
    BUFFER_BPS: 1500,
    /** Refill trigger: divest to the buffer target once liquid drops below 10%. */
    BUFFER_FLOOR_BPS: 1000,
    /** Hard cap on assets deployed into a strategy (≤ 85% → ≥ 15% recoverable). */
    MAX_INVESTED_BPS: 8500,
    /** Don't bother investing dust below this (base units) — avoids churn/fees. */
    MIN_INVEST_BASE: 1_000_000_000,
    /** Max tolerated slippage unwinding a position to cover a withdrawal (0.5%). */
    MAX_UNWIND_SLIPPAGE_BPS: 50,
    /** Harvest cadence (1h) — aligns with the hourly accrual round. */
    HARVEST_INTERVAL_MS: 3_600_000,
    /** Reconciliation tolerance: |total − (liquid + strategyValue)| ≤ this (bps). */
    DRIFT_TOLERANCE_BPS: 1,
  },
} as const;

/** A pool's Faz 3 yield strategy (off-chain mirror of the on-chain `Strategy` enum). */
export type VaultStrategy = 'none' | 'jito_stake' | 'kamino_lend';

/** A single $SCAD-holdings loyalty boost tier (see `VAULT.BOOST_TIERS`). */
export type ScadBoostTier = (typeof VAULT.BOOST_TIERS)[number];

/**
 * The loyalty boost tier a user with `holdingsBase` $SCAD (base units, 9 dp)
 * qualifies for: the highest tier whose `minScadBase` threshold they meet.
 * Negative/zero holdings fall back to the Base tier. The schedule is non-empty,
 * so this always returns a tier.
 */
export function scadBoostTier(holdingsBase: bigint): ScadBoostTier {
  let tier: ScadBoostTier = VAULT.BOOST_TIERS[0];
  for (const t of VAULT.BOOST_TIERS) {
    if (holdingsBase >= t.minScadBase) tier = t;
  }
  return tier;
}

/**
 * The next tier up from the user's current holdings, or `null` if they are
 * already at the top tier — drives the "hold N more $SCAD to reach X" UI.
 */
export function nextScadBoostTier(holdingsBase: bigint): ScadBoostTier | null {
  return VAULT.BOOST_TIERS.find((t) => holdingsBase < t.minScadBase) ?? null;
}

/**
 * A pool's base APR (bps) scaled by a holder's loyalty `multiplierBps`
 * (10000 = 1.00×). Rounded to the nearest bps.
 */
export function boostedAprBps(baseAprBps: number, multiplierBps: number): number {
  return Math.round((baseAprBps * multiplierBps) / 10_000);
}

// ---------- Vault Faz 3 strategy math (V11/V12) ----------
// Pure, BigInt-safe helpers shared by `VaultStrategyService` (off-chain) and
// mirrored by the on-chain `vault_invest`/`vault_divest`/`vault_harvest` CPIs.
// `liquid` = assets sitting in the pool token account; `invested` = assets
// deployed in the strategy; `strategyValue` = the position's current on-chain
// worth (≥ invested once yield accrues). All amounts are asset base units.

/** Liquid balance a pool targets for instant withdrawals (`bufferBps` of total). */
export function bufferTargetAssets(totalAssets: bigint, bufferBps: number): bigint {
  if (totalAssets <= 0n) return 0n;
  return (totalAssets * BigInt(bufferBps)) / 10_000n;
}

/**
 * Idle assets a pool may deploy into its strategy right now: the liquid balance
 * above the buffer target, additionally capped so total `invested` never exceeds
 * `maxInvestedBps` of `totalAssets`. Zero when at/under the buffer or at the cap.
 */
export function investableExcess(args: {
  liquid: bigint;
  invested: bigint;
  totalAssets: bigint;
  bufferBps: number;
  maxInvestedBps: number;
}): bigint {
  const { liquid, invested, totalAssets, bufferBps, maxInvestedBps } = args;
  if (totalAssets <= 0n || liquid <= 0n) return 0n;
  const target = bufferTargetAssets(totalAssets, bufferBps);
  const aboveBuffer = liquid > target ? liquid - target : 0n;
  const investCap = (totalAssets * BigInt(maxInvestedBps)) / 10_000n;
  const capRoom = invested >= investCap ? 0n : investCap - invested;
  return aboveBuffer < capRoom ? aboveBuffer : capRoom;
}

/**
 * Assets to divest back to the buffer when liquid has fallen below the floor.
 * Pulls enough to reach the buffer TARGET (not just the floor), bounded by what
 * is actually invested. Zero while liquid is at/above the floor.
 */
export function divestForBufferFloor(args: {
  liquid: bigint;
  invested: bigint;
  totalAssets: bigint;
  bufferBps: number;
  floorBps: number;
}): bigint {
  const { liquid, invested, totalAssets, bufferBps, floorBps } = args;
  if (totalAssets <= 0n || invested <= 0n) return 0n;
  const floor = bufferTargetAssets(totalAssets, floorBps);
  if (liquid >= floor) return 0n;
  const target = bufferTargetAssets(totalAssets, bufferBps);
  const need = target - liquid; // > 0 since liquid < floor ≤ target
  return need < invested ? need : invested;
}

/** Assets to unwind from the strategy to cover a withdrawal the buffer can't (`net > liquid`). */
export function unwindForWithdrawal(net: bigint, liquid: bigint): bigint {
  return net > liquid ? net - liquid : 0n;
}

/** Minimum acceptable output when unwinding `amount` within a slippage cap. */
export function minOutAfterSlippage(amount: bigint, slippageBps: number): bigint {
  if (amount <= 0n) return 0n;
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

/**
 * Realised strategy yield to credit the pool index at harvest: how much the
 * deployed position has appreciated above its cost basis (`invested`). Never
 * negative (a loss is held, not minted as negative yield — surfaced via drift).
 */
export function harvestableYield(strategyValue: bigint, invested: bigint): bigint {
  return strategyValue > invested ? strategyValue - invested : 0n;
}

/**
 * Strategy reconciliation invariant: a pool's `totalAssets` must equal
 * `liquid + strategyValue` within `toleranceBps`. Returns the signed drift
 * (assets) and whether it is within tolerance — the off-chain analogue of the
 * on-chain check, used flag-only by `ReconciliationService.vaultStrategyDrift`.
 */
export function vaultStrategyDrift(args: {
  totalAssets: bigint;
  liquid: bigint;
  strategyValue: bigint;
  toleranceBps: number;
}): { drift: bigint; ok: boolean } {
  const { totalAssets, liquid, strategyValue, toleranceBps } = args;
  const drift = liquid + strategyValue - totalAssets;
  const abs = drift < 0n ? -drift : drift;
  const tol = (totalAssets * BigInt(toleranceBps)) / 10_000n;
  return { drift, ok: abs <= tol };
}

/**
 * Total NGR redistribution slice (bps): Engine dividend + buy-and-burn + Vault
 * yield. Hard product invariant: this must stay ≤ 2000 bps (≤ 20% of NGR), so
 * the casino keeps ≥ 80% of net revenue. The vault-math test asserts it.
 */
export function ngrRedistributionBps(): number {
  return ENGINE.DIVIDEND_NGR_BPS + ENGINE.BUYBACK_NGR_BPS + VAULT.YIELD_NGR_BPS;
}

/** NGR (lamports) → Vault yield slice (lamports), applying VAULT.YIELD_NGR_BPS. */
export function vaultYieldSliceLamports(ngrLamports: bigint): bigint {
  if (ngrLamports <= 0n) return 0n;
  return (ngrLamports * BigInt(VAULT.YIELD_NGR_BPS)) / 10_000n;
}

/**
 * Convert a lamport amount to $SCAD base units (9 decimals) at the fixed
 * internal rates: Jeton→USD via JETON.LAMPORTS_PER_USD, USD→SCAD via
 * USD_PER_SCAD. Integer math (BigInt-safe) — the Vault yield slice is taken from
 * NGR (Jeton lamports) and credited to the pools in SCAD. Mirrors
 * `lamportsToUsdsBase`, but targets SCAD instead of USDS.
 */
export function lamportsToScadBase(lamports: bigint): bigint {
  if (lamports <= 0n) return 0n;
  const scadBasePerUsd = BigInt(Math.round(10 ** LOTTERY.SCAD_DECIMALS / USD_PER_SCAD));
  return (lamports * scadBasePerUsd) / BigInt(JETON.LAMPORTS_PER_USD);
}

/**
 * Shares minted for an `assets` deposit at the pool's current `indexRay`.
 * shares = assets · RAY / indexRay. At genesis (index = RAY) this is 1:1.
 */
export function sharesForDeposit(assets: bigint, indexRay: bigint): bigint {
  if (assets <= 0n || indexRay <= 0n) return 0n;
  return (assets * VAULT.RAY) / indexRay;
}

/**
 * Asset value of `shares` at the pool's current `indexRay`.
 * assets = shares · indexRay / RAY. Rounds DOWN (in the pool's favour), so a
 * deposit→withdraw round-trip at an unchanged index never returns more than the
 * principal.
 */
export function assetsForShares(shares: bigint, indexRay: bigint): bigint {
  if (shares <= 0n || indexRay <= 0n) return 0n;
  return (shares * indexRay) / VAULT.RAY;
}

/**
 * New pool index after adding `yieldAssets` to a pool with `totalShares`
 * outstanding: index' = index + yieldAssets · RAY / totalShares. Monotonic
 * non-decreasing for non-negative yield; a no-op when the pool is empty.
 */
export function applyAccrual(indexRay: bigint, totalShares: bigint, yieldAssets: bigint): bigint {
  if (totalShares <= 0n || yieldAssets <= 0n) return indexRay;
  return indexRay + (yieldAssets * VAULT.RAY) / totalShares;
}

/**
 * Penalty (in asset base units) charged on an early, pre-maturity withdrawal of
 * `assets`. The penalty stays in the pool (credited to the index), rewarding the
 * stakers who hold to maturity. Zero for non-positive input.
 */
export function earlyExitPenalty(assets: bigint): bigint {
  if (assets <= 0n) return 0n;
  return (assets * BigInt(VAULT.EARLY_EXIT_PENALTY_BPS)) / 10_000n;
}

// ---------- Instant provably-fair games (dual-currency expansion) ----------
// Stake-style single-player, house-banked games. Min/max bets share the casino
// defaults. Payout helpers below bake the house edge into the multiplier so EV
// is correct regardless of player choices.

export const DICE = {
  MIN_BET_LAMPORTS: 1_000_000,
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL,
  HOUSE_EDGE,
  MIN_TARGET: 2, // roll-under target, in [MIN_TARGET, MAX_TARGET]
  MAX_TARGET: 98,
} as const;

/** Roll-under dice payout: (1-edge) / winChance, winChance = target/100. */
export function diceMultiplier(target: number, edge = DICE.HOUSE_EDGE): number {
  return Math.floor(((100 * (1 - edge)) / target) * 100) / 100;
}

export const LIMBO = {
  MIN_BET_LAMPORTS: 1_000_000,
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL,
  HOUSE_EDGE,
  MIN_TARGET: 1.01,
  MAX_TARGET: 1_000_000,
} as const;

export const WHEEL = {
  MIN_BET_LAMPORTS: 1_000_000,
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL,
  // Weighted bucket SHAPE (medium risk). segmentCount = sum of weights; the spin
  // index maps to a bucket by cumulative weight. The relative multipliers/weights
  // define the feel; the absolute payouts are SCALED so EV === RTP (see
  // `wheelScaledBuckets`). The 0 bucket stays 0.
  BUCKETS: [
    { multiplier: 0, weight: 32 },
    { multiplier: 1.2, weight: 30 },
    { multiplier: 1.5, weight: 14 },
    { multiplier: 2, weight: 6 },
    { multiplier: 3, weight: 3 },
    { multiplier: 5, weight: 1 },
  ],
} as const;

/** Total weight = wheel segment count. */
export const WHEEL_SEGMENTS = WHEEL.BUCKETS.reduce((a, b) => a + b.weight, 0);

/**
 * Scale the raw bucket multipliers by a single factor so the wheel's expected
 * value equals `targetRtp` (default 95%), preserving the bucket shape. Winning
 * multipliers are floored to 2 dp (matching the other payout helpers — the
 * residual rounding stays in the house's favour). The losing (0×) bucket is
 * untouched.
 */
export function wheelScaledBuckets(targetRtp = RTP): { multiplier: number; weight: number }[] {
  const rawEv = WHEEL.BUCKETS.reduce((a, b) => a + b.weight * b.multiplier, 0) / WHEEL_SEGMENTS;
  const k = targetRtp / rawEv;
  return WHEEL.BUCKETS.map((b) => ({
    multiplier: b.multiplier === 0 ? 0 : Math.floor(b.multiplier * k * 100) / 100,
    weight: b.weight,
  }));
}

/** Pre-scaled buckets at the platform RTP (computed once). */
export const WHEEL_PAYOUT_BUCKETS = wheelScaledBuckets();

/** Map a spin index in [0, WHEEL_SEGMENTS) to its (scaled) bucket multiplier. */
export function wheelMultiplier(index: number): number {
  let acc = 0;
  for (const b of WHEEL_PAYOUT_BUCKETS) {
    acc += b.weight;
    if (index < acc) return b.multiplier;
  }
  return 0;
}

/** Expected value of a set of weighted buckets (for tests / tuning). */
export function wheelExpectedValue(
  buckets: { multiplier: number; weight: number }[] = WHEEL_PAYOUT_BUCKETS,
): number {
  const totalWeight = buckets.reduce((a, b) => a + b.weight, 0);
  return buckets.reduce((a, b) => a + b.weight * b.multiplier, 0) / totalWeight;
}

export const PLINKO = {
  MIN_BET_LAMPORTS: 1_000_000,
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL,
  ROWS: [8, 12, 16] as const,
  // bin → multiplier SHAPE (length rows+1), medium risk (Stake-style). These are
  // relative shapes; the absolute payouts are SCALED so each row's binomial EV
  // equals RTP (see `plinkoScaledPayouts` / `plinkoPayouts`).
  PAYOUTS: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 1, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  } as Record<number, number[]>,
} as const;

/** Binomial coefficient C(n, k) (small n — plinko rows ≤ 16). */
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 0; i < k; i += 1) c = (c * (n - i)) / (i + 1);
  return c;
}

/** Probability that a ball lands in `bin` for `rows` (fair left/right at each peg). */
export function plinkoBinProbability(rows: number, bin: number): number {
  return binomial(rows, bin) / 2 ** rows;
}

/** Binomial-weighted expected value of a plinko payout row (for tests / tuning). */
export function plinkoExpectedValue(payouts: number[]): number {
  const rows = payouts.length - 1;
  return payouts.reduce((acc, mult, bin) => acc + plinkoBinProbability(rows, bin) * mult, 0);
}

/**
 * Scale a row's payout shape by a single factor so its binomial EV equals
 * `targetRtp` (default 95%), preserving the symmetric shape. Each entry is
 * floored to 2 dp (residual rounding stays in the house's favour).
 */
export function plinkoScaledPayouts(rows: number, targetRtp = RTP): number[] {
  const raw = PLINKO.PAYOUTS[rows];
  if (!raw) return [];
  const k = targetRtp / plinkoExpectedValue(raw);
  return raw.map((m) => Math.floor(m * k * 100) / 100);
}

/** Pre-scaled payout tables at the platform RTP (computed once per row). */
export const PLINKO_PAYOUTS: Record<number, number[]> = Object.fromEntries(
  PLINKO.ROWS.map((rows) => [rows, plinkoScaledPayouts(rows)]),
);

/** Scaled payout row for `rows`, or `undefined` if `rows` is unsupported. */
export function plinkoPayouts(rows: number): number[] | undefined {
  return PLINKO_PAYOUTS[rows];
}

export const MINES = {
  MIN_BET_LAMPORTS: 1_000_000,
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL,
  HOUSE_EDGE,
  CELLS: 25,
  MIN_MINES: 1,
  MAX_MINES: 24,
} as const;

/**
 * Mines multiplier after `picks` successful (safe) reveals: the inverse of the
 * probability of surviving that many picks, with the edge applied once.
 */
export function minesMultiplier(
  mines: number,
  picks: number,
  cells = MINES.CELLS,
  edge = MINES.HOUSE_EDGE,
): number {
  let p = 1;
  for (let i = 0; i < picks; i += 1) {
    p *= (cells - mines - i) / (cells - i); // P(i-th pick safe)
  }
  if (p <= 0) return 0;
  return Math.floor(((1 - edge) / p) * 100) / 100;
}

export const HILO = {
  MIN_BET_LAMPORTS: 1_000_000,
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL,
  HOUSE_EDGE,
  // Card ranks 0 (Ace) … 12 (King). Infinite-deck model (rank = card % 13).
  RANKS: 13,
  // Max guesses in a round before it auto-cashes-out (the committed card
  // sequence has MAX_STEPS + 1 cards: a base card + one per guess).
  MAX_STEPS: 25,
} as const;

export type HiloDirection = 'higher' | 'lower';

/**
 * Probability that the NEXT card satisfies the guess given the current rank,
 * infinite-deck with ties counting as a win for the chosen direction:
 *  - `higher` = higher-or-same → (RANKS - rank) / RANKS
 *  - `lower`  = lower-or-same  → (rank + 1) / RANKS
 * So the extremes (Ace / King) always have a guaranteed-win option.
 */
export function hiloWinProbability(
  rank: number,
  direction: HiloDirection,
  ranks = HILO.RANKS,
): number {
  return direction === 'higher' ? (ranks - rank) / ranks : (rank + 1) / ranks;
}

/**
 * Hi-Lo per-step multiplier: the inverse of the win probability with the house
 * edge applied, floored to 2 dp (matching `minesMultiplier`/`towerMultiplier`).
 * The round multiplier is the running product of these step multipliers.
 */
export function hiloStepMultiplier(
  rank: number,
  direction: HiloDirection,
  edge = HILO.HOUSE_EDGE,
): number {
  const p = hiloWinProbability(rank, direction);
  if (p <= 0) return 0;
  return Math.floor(((1 - edge) / p) * 100) / 100;
}

export const TOWER = {
  MIN_BET_LAMPORTS: 1_000_000,
  MAX_BET_LAMPORTS: 100 * LAMPORTS_PER_SOL,
  HOUSE_EDGE,
  ROWS: 8,
  COLUMNS: 3,
  SAFE_PER_ROW: 2,
} as const;

/** Tower multiplier after climbing `rows` rows successfully. */
export function towerMultiplier(
  rows: number,
  columns = TOWER.COLUMNS,
  safePerRow = TOWER.SAFE_PER_ROW,
  edge = TOWER.HOUSE_EDGE,
): number {
  const perRow = columns / safePerRow; // inverse survival prob per row
  return Math.floor((1 - edge) * perRow ** rows * 100) / 100;
}

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
  // Anti-spam: only players who have wagered at least this much (lifetime
  // `totalWagered`) may post in general chat — i.e. they have skin in the game.
  // 0.01 SOL equivalent. Moderators/admins are exempt.
  MIN_WAGERED_LAMPORTS: LAMPORTS_PER_SOL / 100,
} as const;

// ---------- Geo blocklist ----------
export const BLOCKED_COUNTRIES = ['US', 'GB', 'FR', 'DE', 'ES', 'NL'] as const;

// ---------- Legal / compliance ----------
// The composite version a user accepts (ToS/AML/Privacy/Cookie). Bump this to
// re-trigger the blocking legal-acceptance gate for everyone (#48).
export const LEGAL_VERSION = '2026-06-15';
