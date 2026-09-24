import type { ScadiumApi } from './container';

/**
 * Worker bindings, vars and secrets.
 *
 * Everything an operator might change lives here rather than in code: the
 * container role, its idle timeout, the allowed CORS origin and every credential.
 * Vars are declared in `wrangler.jsonc`; secrets are set with `wrangler secret put`
 * and are never committed.
 */
export interface Env {
  /** Durable Object namespace backing the API container. */
  SCADIUM_API: DurableObjectNamespace<ScadiumApi>;

  // ---- vars (wrangler.jsonc) ----
  /** `api` | `worker` | `both` — which process(es) the container runs. */
  PROCESS_MODE?: string;
  /** Idle timeout before the container sleeps, e.g. "5m". Keeps spend inside the plan allotment. */
  SLEEP_AFTER?: string;
  /**
   * "false" to leave the container running after the hourly cron sweep. Default
   * stops it, which is what keeps an unvisited site inside the free allotments.
   * Set to "false" once real players are online.
   */
  CRON_STOP_CONTAINER?: string;
  /** How many times the cron retries the job sweep (the container is usually cold). */
  CRON_SWEEP_ATTEMPTS?: string;
  /** Pause between sweep attempts, in ms — long enough to cover a cold boot. */
  CRON_SWEEP_BACKOFF_MS?: string;
  /**
   * Hard ceiling on container active time per UTC day, in seconds (default 3600).
   * Past it the API returns 503 and the live games are offline until midnight UTC.
   * This is what keeps container billing and Neon's free compute-hours bounded.
   */
  DAILY_ACTIVE_SECONDS?: string;
  /** Seconds between budget heartbeats (default 60) — the most the cap can overrun by. */
  BUDGET_HEARTBEAT_SECONDS?: string;
  /** Comma-separated path prefixes served even past the cap (default: health + crash cash-out). */
  BUDGET_EXEMPT_PATHS?: string;
  /** Allowed browser origin for the API's CORS. */
  CORS_ORIGIN?: string;
  /**
   * Name of the singleton container instance. Rotate this (e.g. -v3) to allocate a
   * fresh Durable Object if the container's persisted lifecycle state ever wedges.
   */
  CONTAINER_INSTANCE?: string;
  /** Public API origin, used when building the cron's internal request URL. */
  API_ORIGIN?: string;

  // ---- secrets (wrangler secret put) ----
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  INTERNAL_JOB_SECRET?: string;
  METRICS_TOKEN?: string;
  GEO_IP_SALT?: string;
  GEO_PROXY_SECRET?: string;
  /** A dedicated RPC may carry an API key, so it is a secret (unset → the network's public RPC). */
  SOLANA_RPC_URL?: string;
  SOLANA_NETWORK?: string;
  /** Custody hot wallet (ADR 0005): the treasury key. Never a var, never in the repo. */
  CUSTODY_HOT_WALLET_SECRET_KEY?: string;
}
