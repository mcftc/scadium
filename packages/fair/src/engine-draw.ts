/**
 * SCAD Engine v2 — big-reward draw (E4).
 *
 * Each hourly block routes a slice of its reward to ONE play-rate-weighted
 * RANDOM winner: every miner with play-rate that hour can win, with probability
 * proportional to their play-rate (an equal-chance sweepstakes — not gambling).
 *
 * The pick reuses the provably-fair jackpot machinery: a committed seed yields a
 * uniform ticket in `[0, totalPlayRate)` (see `jackpotWinningTicket`), and this
 * walks the participants' cumulative play-rate — in a FIXED order — to find
 * whose range contains the ticket. Anyone can reproduce it from the revealed
 * seed + the per-miner play-rates.
 */
export function weightedWinnerIndex(ticket: bigint, weights: bigint[]): number {
  let cumulative = 0n;
  for (let i = 0; i < weights.length; i += 1) {
    cumulative += weights[i]!;
    if (ticket < cumulative) return i;
  }
  // ticket == sum(weights) — only reachable if ticket was not reduced mod total;
  // fall back to the last participant.
  return Math.max(0, weights.length - 1);
}
