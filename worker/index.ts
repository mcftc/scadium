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

    return getContainer(env.SCADIUM_API).fetch(request);
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
          const response = await getContainer(env.SCADIUM_API).fetch(
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
        } catch (e) {
          console.error(`cron: job sweep threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
