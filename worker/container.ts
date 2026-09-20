import { Container } from '@cloudflare/containers';
import type { Env } from './env';

/** Port the NestJS API listens on inside the image (matches `EXPOSE 4000`). */
const CONTAINER_PORT = 4000;

/**
 * Idle timeout default. Deliberately short: the Workers Paid plan includes
 * 25 GiB-hours of container memory per month, which is ~25 hours for the `basic`
 * (1 GiB) instance type. A short idle window keeps a pre-launch deployment inside
 * that allotment — see the cost model in the migration spec §7. Override with the
 * SLEEP_AFTER var; pin it long (or override onActivityExpired) once there are
 * real players. Note that Neon's free tier also caps compute-hours, so a pinned
 * always-on container requires a paid database plan too (spec §8.4).
 */
const DEFAULT_SLEEP_AFTER = '10m';

/**
 * COLD START, and why requests are not held open for it.
 *
 * Measured boot for this image is ~23s: redis-server, then `prisma migrate
 * deploy` (a real round trip to Neon), then a NestJS graph of ~40 modules.
 * The library waits TIMEOUT_TO_GET_PORTS_MS (20s) for the port, so the first
 * request after a sleep fails — but the container keeps booting in the
 * background and subsequent requests succeed. That is the intended behaviour
 * and it is deliberately NOT replaced with a long blocking wait: an earlier
 * attempt to await startAndWaitForPorts() with a 180s timeout held every
 * request open for three minutes and wedged the Durable Object.
 *
 * Consequence for clients: the first page load after an idle period sees a
 * few failed calls, then works. socket.io reconnects automatically. To remove
 * cold starts entirely, stop the container sleeping (raise SLEEP_AFTER or
 * override onActivityExpired) — but note that always-on also requires a paid
 * Neon plan, because the free tier caps compute-hours (spec §8.4).
 */

/**
 * The Scadium API container: one Durable Object, one long-lived Linux process
 * running NestJS (and, per PROCESS_MODE, the BullMQ worker) with Redis on loopback.
 *
 * `max_instances: 1` in wrangler.jsonc enforces the single-replica constraint the
 * app already requires: leader election has no request-forwarding, so a second
 * replica would reject gameplay writes (the H12 caveat).
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

  override onStart(): void {
    console.log(`scadium container started (PROCESS_MODE=${this.env.PROCESS_MODE ?? 'api'})`);
  }

  override onStop(params: { exitCode: number; reason: string }): void {
    // Expected on idle sleep, on deploys, and on the irregular host restarts
    // Cloudflare makes no guarantee against. The API's boot recovery
    // (recoverStrandedRounds/recoverScheduledBets) settles anything left mid-round.
    console.log(`scadium container stopped: code=${params.exitCode} reason=${params.reason}`);
  }

  override onError(error: unknown): unknown {
    console.error('scadium container error:', error);
    // Deliberately does NOT rethrow. This hook runs on the container monitor;
    // throwing from it wedged the Durable Object so the container could never
    // restart. Report and let the library's own retry path handle recovery.
    return error;
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
