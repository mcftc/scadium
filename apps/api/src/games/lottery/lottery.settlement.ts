import { LOTTERY, lotteryPoolSplit } from '@scadium/shared';

export interface BracketSettlement {
  /** Per-bracket slice of the pool (after burn), index 0..5. */
  bracketSlices: bigint[];
  /** Equal per-winner payout in each bracket (0 where there are no winners). */
  perWinner: bigint[];
  /** Unwon slice + floor-division dust per bracket, rolled into the next round. */
  bracketRollover: bigint[];
  /** 20% treasury slice burned this round. */
  burn: bigint;
  /** Total carried into the next round's pool (sum of bracketRollover). */
  nextRollover: bigint;
}

/**
 * Pure PancakeSwap-style settlement of a round's pool given the winner count in
 * each of the 6 brackets. Burn is taken off the top; each bracket's slice is
 * split EQUALLY among its winners; brackets with no winners (and floor dust)
 * roll forward. Kept side-effect-free so it can be unit-tested in isolation.
 */
export function splitBracketPrizes(
  totalPool: bigint,
  bracketWinnerCounts: number[],
): BracketSettlement {
  const B = LOTTERY.BRACKET_COUNT;
  const { brackets: bracketSlices, burn } = lotteryPoolSplit(totalPool);
  const perWinner = new Array<bigint>(B).fill(BigInt(0));
  const bracketRollover = new Array<bigint>(B).fill(BigInt(0));
  for (let b = 0; b < B; b++) {
    const slice = bracketSlices[b] ?? BigInt(0);
    const count = bracketWinnerCounts[b] ?? 0;
    if (count > 0) {
      perWinner[b] = slice / BigInt(count);
      bracketRollover[b] = slice - perWinner[b]! * BigInt(count); // floor dust
    } else {
      bracketRollover[b] = slice; // no winners → whole slice rolls forward
    }
  }
  // The per-bracket flooring inside lotteryPoolSplit can leave a few base units
  // of the winner-share unallocated. Roll it forward too so no $SCAD is ever
  // lost — burn + paid + rollover === totalPool exactly.
  const winnerShare = totalPool - burn;
  const allocated = bracketSlices.reduce((a, c) => a + c, BigInt(0));
  const splitResidual = winnerShare - allocated;
  const nextRollover =
    bracketRollover.reduce((a, c) => a + c, BigInt(0)) + splitResidual;
  return { bracketSlices, perWinner, bracketRollover, burn, nextRollover };
}
