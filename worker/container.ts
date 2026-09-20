import { Container } from '@cloudflare/containers';
import type { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

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
   * Account for container active time against a per-UTC-day budget.
   *
   * Why this exists: container billing and Neon's free compute-hours both track
   * how long this thing is awake, and a handful of visitors (or one crawler)
   * could otherwise keep it running all day. This puts a hard ceiling on it —
   * the owner's stated requirement is "active at most ~1 hour a day for now",
   * with the live games simply offline outside that.
   *
   * Accounting is deliberately conservative. Each call adds the time since the
   * previous call, clamped to the sleep window (a longer gap means the container
   * had already slept, so only the cold start counts). A first call in a new
   * window is charged BOOT_COST_SECONDS because waking it really does burn that.
   *
   * `record` is false for a read-only check (used by the cron, which must run
   * regardless) and true when a visitor request is about to touch the container.
   */
  async consumeActiveBudget(record: boolean): Promise<BudgetState> {
    const capSeconds = Number(this.env.DAILY_ACTIVE_SECONDS ?? DEFAULT_DAILY_ACTIVE_SECONDS);
    const windowSeconds = parseMinutes(this.env.SLEEP_AFTER ?? DEFAULT_SLEEP_AFTER);
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    const stored = (await this.ctx.storage.get<StoredBudget>(BUDGET_KEY)) ?? null;
    const fresh = !stored || stored.day !== today;
    const state: StoredBudget = fresh
      ? { day: today, usedSeconds: 0, lastSeenMs: 0 }
      : { ...stored };

    if (record) {
      const gapSeconds = state.lastSeenMs ? (now - state.lastSeenMs) / 1000 : Infinity;
      state.usedSeconds +=
        gapSeconds <= windowSeconds ? Math.max(0, gapSeconds) : BOOT_COST_SECONDS;
      state.lastSeenMs = now;
      await this.ctx.storage.put(BUDGET_KEY, state);
    }

    return {
      allowed: state.usedSeconds < capSeconds,
      usedSeconds: Math.round(state.usedSeconds),
      capSeconds,
      day: state.day,
    };
  }
}

/** Storage key for the daily active-time budget. */
const BUDGET_KEY = 'scadium:daily-active-budget';

/** Default ceiling on container active time per UTC day. */
const DEFAULT_DAILY_ACTIVE_SECONDS = 3600;

/** What a cold start really costs, charged when the container had been asleep. */
const BOOT_COST_SECONDS = 40;

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

interface StoredBudget {
  day: string;
  usedSeconds: number;
  lastSeenMs: number;
}

export interface BudgetState {
  allowed: boolean;
  usedSeconds: number;
  capSeconds: number;
  day: string;
}

/**
 * Parse a sleepAfter expression to seconds: "5m", "90s", "2h".
 *
 * Only used to clamp budget accounting, never to configure the container itself,
 * so precision here is not load-bearing. A bare number is read as minutes (a
 * bare *numeric type* is passed through as seconds, matching the library); with
 * the configured "5m" neither path is reachable, and an unparseable value falls
 * back to 5 minutes. Erring long only makes accounting more conservative.
 */
function parseMinutes(expr: string | number): number {
  if (typeof expr === 'number') return expr;
  const m = /^(\d+)\s*([smh])?$/.exec(expr.trim());
  if (!m) return 300;
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3600 : m[2] === 's' ? n : n * 60;
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
