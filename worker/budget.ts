/**
 * Daily active-time budget — the pure accounting, kept out of the Durable Object
 * so it can be tested without workerd (`node --test worker/budget.test.ts`).
 *
 * What is charged is container RUNNING time, sampled by a heartbeat while the
 * container is up. The first version charged the gaps between HTTP requests,
 * which missed the main way the container stays awake: an open WebSocket counts
 * as an in-flight request to the container library, so one idle browser tab kept
 * it running until the hourly stop while the budget saw ~80s an hour.
 */

export interface StoredBudget {
  /** UTC day (YYYY-MM-DD) this record accounts for. */
  day: string;
  usedSeconds: number;
  /** Last heartbeat that saw the container running; 0 = no chain running. */
  lastBeatMs: number;
  /** A cron sweep is in progress until then — the budget must not stop it. */
  sweepUntilMs: number;
}

export interface BudgetState {
  allowed: boolean;
  usedSeconds: number;
  capSeconds: number;
  day: string;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The stored record, rolled over to a fresh one on a new UTC day. */
export function forToday(
  stored: Partial<StoredBudget> | null | undefined,
  now: number,
): StoredBudget {
  const day = utcDay(now);
  if (!stored || stored.day !== day) {
    // Carry the running chain across midnight so the next beat charges from it.
    return {
      day,
      usedSeconds: 0,
      lastBeatMs: stored?.lastBeatMs ?? 0,
      sweepUntilMs: stored?.sweepUntilMs ?? 0,
    };
  }
  return {
    day,
    usedSeconds: stored.usedSeconds ?? 0,
    lastBeatMs: stored.lastBeatMs ?? 0,
    sweepUntilMs: stored.sweepUntilMs ?? 0,
  };
}

/**
 * One heartbeat. Charges the time since the previous beat when the container is
 * running, clamped to `maxGapMs` so a beat that ran late (an evicted object, a
 * delayed alarm) cannot bill an interval nobody observed. A stopped container
 * ends the chain.
 */
export function chargeHeartbeat(
  budget: StoredBudget,
  now: number,
  running: boolean,
  maxGapMs: number,
): StoredBudget {
  if (!running) return { ...budget, lastBeatMs: 0 };
  const gapMs = budget.lastBeatMs ? Math.min(Math.max(0, now - budget.lastBeatMs), maxGapMs) : 0;
  return { ...budget, usedSeconds: budget.usedSeconds + gapMs / 1000, lastBeatMs: now };
}

export function budgetState(budget: StoredBudget, capSeconds: number): BudgetState {
  return {
    allowed: budget.usedSeconds < capSeconds,
    usedSeconds: Math.round(budget.usedSeconds),
    capSeconds,
    day: budget.day,
  };
}

/** True when the heartbeat should stop the container: over budget, and no cron sweep running. */
export function shouldStop(budget: StoredBudget, capSeconds: number, now: number): boolean {
  return budget.usedSeconds >= capSeconds && now >= budget.sweepUntilMs;
}
