import { Container } from '@cloudflare/containers';
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Read lazily by the base class, so assigning here is safe.
    this.sleepAfter = env.SLEEP_AFTER ?? DEFAULT_SLEEP_AFTER;
    this.envVars = buildContainerEnv(env);
  }
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
