import { getContainer } from '@cloudflare/containers';
import { ScadiumApi } from './container';
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

/** Resolve the single authoritative container instance. */
function apiContainer(env: Env) {
  return getContainer(env.SCADIUM_API, env.CONTAINER_INSTANCE ?? DEFAULT_INSTANCE);
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

    ctx.waitUntil(
      (async () => {
        const started = Date.now();
        try {
          const response = await apiContainer(env).fetch(
            new Request(`https://container${RUN_ALL_JOBS_PATH}`, {
              method: 'POST',
              headers: {
                [INTERNAL_SECRET_HEADER]: secret,
                'content-type': 'application/json',
              },
              body: '{}',
            }),
          );
          const body = await response.text();
          const elapsed = Date.now() - started;
          if (!response.ok) {
            console.error(`cron: job sweep failed (${response.status}) after ${elapsed}ms: ${body}`);
            return;
          }
          console.log(`cron: job sweep ok after ${elapsed}ms: ${body}`);

          // Put the container straight back to sleep instead of letting it idle
          // out. This is the difference between the site costing nothing and
          // costing real money while NOBODY is using it: at the hourly cron,
          // lingering for SLEEP_AFTER works out at ~73 container-hours/month
          // (8.8x over the plan's included 25 GiB-hours, and 73% of Neon free's
          // 100 CU-hours) versus ~10 h/month if it stops as soon as it is done.
          //
          // Set CRON_STOP_CONTAINER=false once there are real players: stopping
          // here would disconnect anyone mid-round.
          if ((env.CRON_STOP_CONTAINER ?? 'true') !== 'false') {
            try {
              await apiContainer(env).stop();
              console.log('cron: container stopped');
            } catch (e) {
              console.warn(`cron: could not stop container: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        } catch (e) {
          console.error(`cron: job sweep threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
