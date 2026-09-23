import { Container } from '@cloudflare/containers';
import type { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import {
  budgetState,
  chargeHeartbeat,
  forToday,
  shouldStop,
  type BudgetState,
  type StoredBudget,
} from './budget';

export type { BudgetState } from './budget';

/** Port the NestJS API listens on inside the image (matches `EXPOSE 4000`). */
const CONTAINER_PORT = 4000;

/**
 * Idle timeout default.
 *
 * This is a BUDGET control as much as a latency one. The crash engine writes a
 * round every ~10-20s while the container is up, so Neon's compute-hours track
 * container uptime almost exactly, and container memory is billed per GiB-hour
 * against the plan's included 25 GiB-hours. The hourly cron stops the container
 * when it is done (see worker/index.ts), so this timeout only governs how long
 * the container lingers after a real visitor.
 */
const DEFAULT_SLEEP_AFTER = '5m';

/**
 * COLD START, and why requests are not held open for it.
 *
 * Measured time to listening: ~36s at 0.25 vCPU, ~28s at 0.5, ~22s at 1 — against
 * the library's 20s `TIMEOUT_TO_GET_PORTS_MS`. Boot is redis-server, then
 * `prisma migrate deploy` (a real round trip to Neon), then a NestJS graph of ~40
 * modules; sub-20s is not reachable while migrations run on boot. So the first
 * request after a sleep fails, the container finishes booting in the background,
 * and later requests serve in ~1s. socket.io reconnects and TanStack Query
 * retries, so a page loaded cold recovers on its own.
 *
 * Do NOT "fix" this by awaiting startAndWaitForPorts() with a long timeout — it
 * was tried, and it held every request open for three minutes and wedged the
 * Durable Object.
 *
 * NOTE: this class deliberately declares NO lifecycle hooks (onStart/onStop/
 * onError). An earlier `onError` that rethrew left the container's persisted
 * state (`__CF_CONTAINER_STATE`) in a status the library would never restart
 * from — and because that state outlives the code, reverting did not clear it.
 * Keep this subclass to configuration only.
 */
export class ScadiumApi extends Container<Env> {
  defaultPort = CONTAINER_PORT;
  /** The container reaches Neon (Postgres over TCP) and Solana RPC. */
  enableInternet = true;

  // `DurableObject['ctx']` is exactly what the Container base class declares;
  // writing `DurableObjectState` here picks up a different generic default from
  // @cloudflare/workers-types and fails to match.
  constructor(ctx: DurableObject['ctx'], env: Env) {
    super(ctx, env);
    // Read lazily by the base class, so assigning here is safe.
    this.sleepAfter = env.SLEEP_AFTER ?? DEFAULT_SLEEP_AFTER;
    this.envVars = buildContainerEnv(env);
  }

  /**
   * Proxy to the container, recovering from the state desync that otherwise
   * makes this deployment unrecoverable after the container sleeps.
   *
   * Symptom: after a sleep, every request fails with "The container is not
   * running, consider calling start()" and only a redeploy fixes it. That string
   * is NOT one of the library's errors (`the container is not listening`, etc.)
   * — it comes from the workerd runtime. So the Durable Object still believes
   * the container is running and proxies straight through, while the runtime
   * knows it is gone. Because the object's view says "running",
   * `startAndWaitForPorts()` skips starting and the two views never reconcile.
   *
   * Recovery is therefore to force the state back in sync: `destroy()` (SIGKILL
   * + onStop, which clears the object's belief) and then start for real.
   *
   * Timeouts are deliberately short and every failure is swallowed. An earlier
   * attempt to await a 180s start held every request open for three minutes, and
   * rethrowing from this path wedged the object outright — so on failure we fall
   * through and let the caller get a fast, honest error while the container
   * finishes starting in the background.
   */
  override async fetch(request: Request): Promise<Response> {
    const first = await this.tryFetch(request);
    if (!(await isContainerGone(first))) return unwrap(first);

    console.warn('container state desync — forcing a restart');
    try {
      await this.destroy();
    } catch {
      // Already gone; that is the outcome we wanted.
    }
    try {
      await this.startAndWaitForPorts(undefined, {
        portReadyTimeoutMS: START_NUDGE_TIMEOUT_MS,
        instanceGetTimeoutMS: 8_000,
      });
    } catch {
      // Still booting — fall through; the next request will find it.
    }
    return unwrap(await this.tryFetch(request));
  }

  /** Run the base fetch, capturing a throw as a value so both shapes are handled. */
  private async tryFetch(request: Request): Promise<Response | Error> {
    try {
      return await super.fetch(request);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * The per-UTC-day active-time budget: read it, and make sure its heartbeat is
   * running.
   *
   * Why this exists: container billing and Neon's free compute-hours both track
   * how long this thing is awake, and a handful of visitors (or one crawler)
   * could otherwise keep it running all day. The owner's stated requirement is
   * "active at most ~1 hour a day for now", with the live games offline outside it.
   *
   * What is charged is RUNNING time, sampled by `budgetHeartbeat` — not the gaps
   * between HTTP requests. An open WebSocket keeps the container awake with no
   * requests at all (the library counts it as in-flight), which is how the old
   * request-gap accounting let one idle tab run the container nearly all day.
   *
   * `record` is true when a request is about to touch the container (it starts
   * the heartbeat chain if none is running). `sweepMs` > 0 marks a cron sweep in
   * progress for that long, which the budget must never stop mid-run.
   */
  async consumeActiveBudget(record: boolean, sweepMs = 0): Promise<BudgetState> {
    const capSeconds = Number(this.env.DAILY_ACTIVE_SECONDS ?? DEFAULT_DAILY_ACTIVE_SECONDS);
    const now = Date.now();
    let budget = forToday(await this.ctx.storage.get<StoredBudget>(BUDGET_KEY), now);

    if (record) {
      let changed = false;
      if (sweepMs > 0) {
        budget = { ...budget, sweepUntilMs: now + sweepMs };
        changed = true;
      }
      if ((await this.listSchedules(HEARTBEAT_CALLBACK)).length === 0) {
        budget = { ...budget, lastBeatMs: now };
        changed = true;
        await this.schedule(heartbeatSeconds(this.env), HEARTBEAT_CALLBACK);
      }
      if (changed) await this.ctx.storage.put(BUDGET_KEY, budget);
    }

    return budgetState(budget, capSeconds);
  }

  /**
   * Heartbeat (scheduled through the library's `schedule()`, which runs inside
   * its own alarm loop). Charges the running time since the last beat, stops
   * the container once the day's budget is spent — SIGTERM, so the API drains
   * the crash round in flight — and re-schedules itself while the container
   * runs. Must never throw: this is library-driven code on the lifecycle path.
   */
  async budgetHeartbeat(): Promise<void> {
    try {
      const capSeconds = Number(this.env.DAILY_ACTIVE_SECONDS ?? DEFAULT_DAILY_ACTIVE_SECONDS);
      const now = Date.now();
      const running = this.ctx.container?.running ?? false;
      const intervalSeconds = heartbeatSeconds(this.env);
      const budget = chargeHeartbeat(
        forToday(await this.ctx.storage.get<StoredBudget>(BUDGET_KEY), now),
        now,
        running,
        2 * intervalSeconds * 1000,
      );
      await this.ctx.storage.put(BUDGET_KEY, budget);
      if (!running) return; // chain ends; the next visitor request restarts it
      if (shouldStop(budget, capSeconds, now)) {
        console.warn(
          `daily active-time budget spent (${Math.round(budget.usedSeconds)}s of ${capSeconds}s) — stopping the container`,
        );
        await this.stop();
        return;
      }
      await this.schedule(intervalSeconds, HEARTBEAT_CALLBACK);
    } catch (e) {
      console.error(`budget heartbeat failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Storage key for the daily active-time budget. */
const BUDGET_KEY = 'scadium:daily-active-budget';

/** Default ceiling on container active time per UTC day. */
const DEFAULT_DAILY_ACTIVE_SECONDS = 3600;

/** Method name the library's scheduler calls for the budget heartbeat. */
const HEARTBEAT_CALLBACK = 'budgetHeartbeat';

/**
 * Heartbeat period, in seconds. 60s bounds how far past the cap the container
 * can run (one interval) while costing one storage write a minute.
 */
const DEFAULT_BUDGET_HEARTBEAT_SECONDS = 60;

function heartbeatSeconds(env: Env): number {
  const n = Number(env.BUDGET_HEARTBEAT_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_HEARTBEAT_SECONDS;
}

/**
 * How long to wait for an explicit start before giving up and letting the
 * request fail fast. Short on purpose — see the note on `fetch()`.
 */
const START_NUDGE_TIMEOUT_MS = 15_000;

/** Signatures meaning the runtime has no container behind this Durable Object. */
const CONTAINER_GONE = /not running|no container instance|not listening/i;

/**
 * Detect the desync from EITHER shape the failure takes.
 *
 * This is the subtlety that made the first attempt at this fix useless: the
 * runtime does not always throw. It usually resolves with a 500 whose *body* is
 * "The container is not running, consider calling start()", so a try/catch alone
 * never fires. Check the body too — cloned, so the original stays readable.
 */
async function isContainerGone(result: Response | Error): Promise<boolean> {
  if (result instanceof Error) return CONTAINER_GONE.test(result.message);
  if (result.status < 500 || result.webSocket) return false;
  try {
    return CONTAINER_GONE.test(await result.clone().text());
  } catch {
    return false;
  }
}

/** Surface a captured throw as a 503 rather than re-throwing (which wedges the object). */
function unwrap(result: Response | Error): Response {
  if (!(result instanceof Error)) return result;
  return new Response(
    JSON.stringify({ statusCode: 503, error: 'Service Unavailable', message: result.message }),
    { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '30' } },
  );
}

/**
 * Map Worker vars/secrets onto the container's process environment.
 * Undefined entries are dropped so the image's own defaults still apply, and no
 * value is hardcoded here.
 */
function buildContainerEnv(env: Env): Record<string, string> {
  const candidates: Record<string, string | undefined> = {
    NODE_ENV: 'production',
    PROCESS_MODE: env.PROCESS_MODE ?? 'both',
    API_PORT: String(CONTAINER_PORT),
    CORS_ORIGIN: env.CORS_ORIGIN,
    DATABASE_URL: env.DATABASE_URL,
    JWT_SECRET: env.JWT_SECRET,
    INTERNAL_JOB_SECRET: env.INTERNAL_JOB_SECRET,
    METRICS_TOKEN: env.METRICS_TOKEN,
    GEO_IP_SALT: env.GEO_IP_SALT,
    GEO_PROXY_SECRET: env.GEO_PROXY_SECRET,
    SOLANA_RPC: env.SOLANA_RPC,
    SOLANA_NETWORK: env.SOLANA_NETWORK,
    HOUSE_WALLET_SECRET_KEY: env.HOUSE_WALLET_SECRET_KEY,
  };
  return Object.fromEntries(
    Object.entries(candidates).filter((e): e is [string, string] => e[1] !== undefined),
  );
}
