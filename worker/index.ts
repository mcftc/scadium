import { ScadiumApi, type BudgetState } from './container';
import type { Env } from './env';

export { ScadiumApi };

/**
 * Path of the API's generic job-trigger route. The API mounts it under the global
 * `api/v1` prefix. Posting to the collection (no `:name`) runs every job, so this
 * Worker never needs to know the job names — `JOB_HANDLERS` stays the single
 * source of truth. See migration spec §5.2.
 */
const RUN_ALL_JOBS_PATH = '/api/v1/internal/jobs';

/** Header the API's InternalSecretGuard checks. */
const INTERNAL_SECRET_HEADER = 'x-internal-secret';

/**
 * Name of the singleton container instance.
 *
 * The Container class persists its lifecycle state in Durable Object storage
 * (`__CF_CONTAINER_STATE`). A bad deploy can wedge that state so the container
 * reports "not running, consider calling start()" forever and never restarts —
 * reverting the offending code does NOT clear it, because the state outlives the
 * code. Rotating this name allocates a fresh Durable Object with clean state and
 * is the documented recovery procedure. It is config-driven so recovery is a
 * variable change, not a code change.
 */
const DEFAULT_INSTANCE = 'scadium-api-v2';

/** Sweep attempts, and the pause between them — long enough to cover a cold boot (~36s). */
const DEFAULT_SWEEP_ATTEMPTS = 4;
const DEFAULT_SWEEP_BACKOFF_MS = 30_000;

/**
 * Resolve the single authoritative container instance.
 *
 * Deliberately uses the namespace directly rather than the library's
 * `getContainer()` helper: the helper's return type erases the subclass, which
 * hides this Durable Object's own RPC methods (`consumeActiveBudget`). Resolving
 * by name here is exactly what the helper does internally, and keeps the stub
 * typed as `ScadiumApi`.
 */
function apiContainer(env: Env): DurableObjectStub<ScadiumApi> {
  const name = env.CONTAINER_INSTANCE ?? DEFAULT_INSTANCE;
  return env.SCADIUM_API.get(env.SCADIUM_API.idFromName(name));
}

/**
 * Wake the container, run every economy job, then put it straight back to sleep.
 *
 * Retries matter here. The container is almost always cold when the cron fires,
 * and a cold start takes longer than the container library waits for the port —
 * so the first attempt reliably fails while the container boots in the
 * background. Without a retry the hourly jobs would simply never run. The cron
 * has no latency budget to protect, so it can afford to wait and try again.
 *
 * The stop is in a `finally`: a failed sweep must not leave the container idling
 * for SLEEP_AFTER, which is exactly the runtime this design exists to avoid.
 */
async function runScheduledSweep(env: Env, secret: string): Promise<void> {
  const attempts = Number(env.CRON_SWEEP_ATTEMPTS ?? DEFAULT_SWEEP_ATTEMPTS);
  const backoffMs = Number(env.CRON_SWEEP_BACKOFF_MS ?? DEFAULT_SWEEP_BACKOFF_MS);
  const started = Date.now();

  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await apiContainer(env).fetch(
          new Request(`https://container${RUN_ALL_JOBS_PATH}`, {
            method: 'POST',
            headers: { [INTERNAL_SECRET_HEADER]: secret, 'content-type': 'application/json' },
            body: '{}',
          }),
        );
        const body = await response.text();
        if (response.ok) {
          console.log(`cron: job sweep ok on attempt ${attempt} after ${Date.now() - started}ms: ${body}`);
          return;
        }
        console.warn(`cron: sweep attempt ${attempt}/${attempts} failed (${response.status}): ${body.slice(0, 200)}`);
      } catch (e) {
        console.warn(
          `cron: sweep attempt ${attempt}/${attempts} threw: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (attempt < attempts) await new Promise((r) => setTimeout(r, backoffMs));
    }
    console.error(`cron: job sweep gave up after ${attempts} attempts (${Date.now() - started}ms)`);
  } finally {
    // Always, even when the sweep failed — see the doc comment.
    if ((env.CRON_STOP_CONTAINER ?? 'true') !== 'false') {
      try {
        await apiContainer(env).stop();
        console.log('cron: container stopped');
      } catch (e) {
        console.warn(`cron: could not stop container: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

/**
 * Response served once the container has used its daily active-time allowance.
 * 503 + Retry-After so clients and crawlers back off properly rather than
 * hammering a door that will not open until tomorrow.
 */
function offlineResponse(budget: BudgetState): Response {
  const resetsAt = `${budget.day}T24:00:00Z`;
  return new Response(
    JSON.stringify({
      statusCode: 503,
      error: 'Service Unavailable',
      message:
        'Scadium is paused for today. The live games run on a capped daily budget while the project is pre-launch.',
      dailyActiveSecondsUsed: budget.usedSeconds,
      dailyActiveSecondsCap: budget.capSeconds,
      resumesAt: resetsAt,
    }),
    {
      status: 503,
      headers: {
        'content-type': 'application/json',
        // Seconds until 00:00 UTC, when the budget resets.
        'retry-after': String(secondsUntilUtcMidnight()),
        'cache-control': 'no-store',
      },
    },
  );
}

function secondsUntilUtcMidnight(): number {
  const now = Date.now();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.round((midnight.getTime() - now) / 1000));
}

export default {
  /**
   * Front door for api.scadium.com.
   *
   * Everything is forwarded to the single container instance via `fetch()` — the
   * only method that proxies WebSocket upgrades, which all 8 Socket.io gateways
   * need. `containerFetch()` would silently break them.
   *
   * `getContainer` with no name resolves the same singleton instance for every
   * request, which is what the app requires (one authoritative game loop).
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // The internal job route is reachable only from the scheduled handler below,
    // never from the internet. Belt-and-braces alongside the API's own guard and
    // the edge rule; a leaked secret still should not be enough on its own.
    if (url.pathname.startsWith(RUN_ALL_JOBS_PATH)) {
      return new Response('not found', { status: 404 });
    }

    // Daily active-time cap. Container billing and Neon's free compute-hours both
    // track how long the container is awake, so without a ceiling a crawler or a
    // couple of curious visitors could keep it running all day. Over budget, the
    // games go offline rather than quietly costing money — that is the deliberate
    // trade while the project is pre-launch.
    //
    // Health probes are exempt so the service stays observable when capped.
    if (!url.pathname.startsWith('/health')) {
      try {
        const budget = await apiContainer(env).consumeActiveBudget(true);
        if (!budget.allowed) return offlineResponse(budget);
      } catch (e) {
        // Fail OPEN. This is a cost guard, not a security control: a transient
        // Durable Object error must not take the site down. Logged loudly so the
        // failure is visible rather than silently unbounded.
        console.error(
          `budget check failed, allowing request: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return apiContainer(env).fetch(request);
  },

  /**
   * Hourly Cron Trigger — the scheduling guarantee for a container that sleeps.
   *
   * BullMQ's repeatable schedulers only fire while the worker process is awake, so
   * they cannot be relied on once the container is allowed to idle out. This runs
   * the full job set instead. Every handler is idempotent and period-keyed, so
   * firing alongside the in-process schedulers collapses to one effect, and each is
   * a no-op when its period is already settled.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const secret = env.INTERNAL_JOB_SECRET;
    if (!secret) {
      console.error('cron: INTERNAL_JOB_SECRET unset — skipping job run (fail closed)');
      return;
    }

    ctx.waitUntil(runScheduledSweep(env, secret));
  },
} satisfies ExportedHandler<Env>;
