/**
 * Named throttle profiles (#34). All env-tunable; values are read at import time
 * (same as the existing THROTTLE_TTL/LIMIT handling in app.module).
 *
 * - DEFAULT: the global ceiling every HTTP route gets via the APP_GUARD.
 * - AUTH: stricter window for /auth/nonce, /auth/verify and /auth/refresh —
 *   blunts nonce-grinding and signature/refresh spam.
 * - BET: short-window burst cap for the money endpoints (crash bet/cashout,
 *   coinflip create/join, lottery ticket, jackpot enter). Sized above the
 *   legitimate burst the concurrency suite exercises (20 parallel bets).
 *
 * `ttl` is in MILLISECONDS (what @nestjs/throttler v6 expects); the env knobs
 * stay in seconds for consistency with the pre-existing THROTTLE_TTL.
 */
const envNum = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const DEFAULT_THROTTLE = {
  ttl: envNum('THROTTLE_TTL', 60) * 1000,
  limit: envNum('THROTTLE_LIMIT', 100),
} as const;

export const AUTH_THROTTLE = {
  ttl: envNum('THROTTLE_AUTH_TTL', 60) * 1000,
  limit: envNum('THROTTLE_AUTH_LIMIT', 15),
} as const;

export const BET_THROTTLE = {
  ttl: envNum('THROTTLE_BET_TTL', 10) * 1000,
  limit: envNum('THROTTLE_BET_LIMIT', 30),
} as const;
