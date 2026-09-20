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
  /** Idle timeout before the container sleeps, e.g. "10m". Keeps spend inside the plan allotment. */
  SLEEP_AFTER?: string;
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
  SOLANA_RPC?: string;
  SOLANA_NETWORK?: string;
  HOUSE_WALLET_SECRET_KEY?: string;
}
