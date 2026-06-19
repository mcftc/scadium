/**
 * Issue #212 (double-settle guard). The singleton crash/jackpot/lottery engines
 * elect a single leader over Redis, but a STALLED-then-resumed leader (or a
 * demoted leader still mid-settle) could otherwise re-run a settlement another
 * replica/recovery pass already committed — crediting every bet twice.
 *
 * Two in-transaction guards close that hole, applied to BOTH the live-settle and
 * the boot-recovery paths of all three engines:
 *  1. Re-assert leadership as the FIRST statement inside the `withSerializable`
 *     closure (`assertStillLeader`) — a leader demoted during the await aborts
 *     before any credit.
 *  2. CLAIM the round by flipping its terminal status with a STATUS-GUARDED
 *     `updateMany` (`assertRoundClaimed`): only the settler that transitions the
 *     round out of its non-terminal state(s) wins; a `count === 0` means a peer
 *     already settled it, so we throw to roll the WHOLE tx back (no credits, no
 *     Bet rows) — making settlement idempotent at the DB layer.
 *
 * Both throw `SettleClaimLostError`, which the engines treat as a benign abort
 * (NOT a settlement failure): the round is already terminal and fully settled by
 * the winner, so no dead-letter / SettlementFailure row is written for it.
 */
export class SettleClaimLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettleClaimLostError';
  }
}

/** True when `e` is the benign "another settler already claimed this round" abort. */
export function isSettleClaimLost(e: unknown): boolean {
  return e instanceof SettleClaimLostError;
}

/**
 * Re-assert leadership inside a settlement transaction. Call as the FIRST
 * statement of the `withSerializable` closure: it is evaluated AFTER the tx
 * `await`, so a leader demoted between scheduling the settle and the tx opening
 * self-aborts before crediting anyone. No-op leader (single instance / no Redis)
 * always passes.
 */
export function assertStillLeader(isLeader: () => boolean, game: string): void {
  if (!isLeader()) {
    throw new SettleClaimLostError(`${game}: lost leadership mid-settle — aborting`);
  }
}

/**
 * The guarded terminal-status flip is the concurrency gate. `count` is the rows
 * matched by an `updateMany({ where: { id, status: { in: [<non-terminal>] } } })`:
 * exactly one settler transitions the round to terminal, every other settler
 * sees `count === 0` and throws to roll back the whole tx (so its credits/Bet
 * rows never commit). Idempotent regardless of how many leaders/recovery passes
 * race the same round.
 */
export function assertRoundClaimed(count: number, game: string, roundId: string): void {
  if (count === 0) {
    throw new SettleClaimLostError(
      `${game}: round ${roundId} already settled by another settler — aborting`,
    );
  }
}
