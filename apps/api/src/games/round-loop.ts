/**
 * Shared liveness plumbing for the three scheduled-round engines (crash,
 * jackpot, lottery). Each engine keeps its own game logic; this holds only what
 * they would otherwise copy: the operational tuning, the backoff curve, and a
 * timer set whose callbacks die with the loop generation that armed them.
 */

/** Read an integer env var ≥ `min`, falling back to `fallback` when absent/invalid. */
function envMs(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

/**
 * Operational tuning — read live (not at module load) so tests and operators
 * can override it without a rebuild. Defaults and their origin:
 *  - settleTxTimeoutMs 30s: Prisma's interactive-tx default is 5s, which a busy
 *    round (~7 round trips per bet to a remote Neon) exceeds, and an expired tx
 *    is not retryable — the game then froze until a restart.
 *  - settleTxMaxWaitMs 10s: time to acquire a pooled connection (default 2s),
 *    generous because a cold Neon compute can take seconds to wake.
 *  - settleRetryAttempts 4 / base 2s / max 60s: a settle that failed for a
 *    transient reason (Neon blip, pool timeout) is retried with exponential
 *    backoff before the engine falls back to its recovery path.
 *  - watchdogIntervalMs 10s / stallMs 90s: how often a loop is checked, and how
 *    long it may show no progress before it is resumed. 90s clears the longest
 *    legitimate quiet stretch (a 15s betting window plus a slow 30s settle).
 *  - crashDrainTimeoutMs 120s: on shutdown, how long crash may keep running to
 *    let the in-flight round bust and settle. Cloudflare gives 15 minutes before
 *    SIGKILL; a round is at most ~15s of betting plus about a minute of flight.
 *    0 disables the drain (the integration suite, whose teardown must be quick).
 */
export function roundLoopTuning() {
  return {
    settleTxTimeoutMs: envMs('SETTLE_TX_TIMEOUT_MS', 30_000),
    settleTxMaxWaitMs: envMs('SETTLE_TX_MAX_WAIT_MS', 10_000),
    settleRetryAttempts: envMs('SETTLE_RETRY_ATTEMPTS', 4),
    settleRetryBaseMs: envMs('SETTLE_RETRY_BASE_MS', 2_000),
    settleRetryMaxMs: envMs('SETTLE_RETRY_MAX_MS', 60_000),
    watchdogIntervalMs: envMs('ROUND_WATCHDOG_INTERVAL_MS', 10_000),
    stallMs: envMs('ROUND_STALL_MS', 90_000),
    crashDrainTimeoutMs: envMs('CRASH_DRAIN_TIMEOUT_MS', 120_000, 0),
  };
}

/** Transaction options every settle passes to `withSerializable`. */
export function settleTxOptions() {
  const t = roundLoopTuning();
  return { timeoutMs: t.settleTxTimeoutMs, maxWaitMs: t.settleTxMaxWaitMs };
}

/** Exponential backoff for retry `attempt` (1-based), capped. */
export function retryDelayMs(attempt: number): number {
  const t = roundLoopTuning();
  return Math.min(t.settleRetryMaxMs, t.settleRetryBaseMs * 2 ** Math.max(0, attempt - 1));
}

/**
 * The timers of one round loop. `reset()` cancels every pending callback, so
 * when a loop is resumed (after a failed settle, a stall, or regained
 * leadership) no timer from the abandoned chain can fire into the new one —
 * the "stale draw timer closes the next round early" class of bug.
 */
export class RoundTimers {
  private readonly handles = new Set<NodeJS.Timeout>();
  private gen = 0;

  /**
   * Bumped by every `reset()`. An async loop step captures it on entry and
   * returns after an await if it moved — clearing timers cannot reach code that
   * is already running, so this is how an in-flight step learns it was abandoned.
   */
  get generation(): number {
    return this.gen;
  }

  schedule(fn: () => void, ms: number): void {
    const handle = setTimeout(
      () => {
        this.handles.delete(handle);
        fn();
      },
      Math.max(0, ms),
    );
    this.handles.add(handle);
  }

  reset(): void {
    this.gen += 1;
    for (const handle of this.handles) clearTimeout(handle);
    this.handles.clear();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Message of an unknown error, for logs. */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
