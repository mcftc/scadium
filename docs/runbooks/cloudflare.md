# Runbook — Scadium on Cloudflare

Design: `docs/superpowers/specs/2026-09-20-cloudflare-migration-design.md`

## What runs where

| Piece | Where | Notes |
|---|---|---|
| `apps/web` | Worker `scadium-web` | OpenNext build; routes `scadium.com/*`, `www.scadium.com/*` |
| `apps/api` + `apps/worker` | Container behind Worker `scadium-api` | one image, `PROCESS_MODE=both`; route `api.scadium.com/*` |
| Redis | **inside the container**, loopback, no persistence | ephemeral coordination only — never put durable state there |
| Postgres | **Neon** free (`scadium-devnet`, project `misty-pond-29863296`) | Cloudflare has no Postgres |
| Economy jobs | Cloudflare Cron `0 * * * *` → `POST /api/v1/internal/jobs` | runs all 9; guarded by `INTERNAL_JOB_SECRET` |

## Deploying

```bash
# API + container (builds and pushes the image; takes several minutes)
npx wrangler deploy

# Web
cd apps/web && pnpm cf:build && pnpm cf:deploy
```

Secrets are set once with `npx wrangler secret put <NAME>`:
`DATABASE_URL`, `JWT_SECRET`, `INTERNAL_JOB_SECRET`, `METRICS_TOKEN`,
`GEO_IP_SALT`, `GEO_PROXY_SECRET`. They are never committed.

## Expected behaviour after an idle period

The container sleeps after `SLEEP_AFTER` (10m). Waking it takes longer than the
20s the Workers container library waits, so:

- the **first** request returns 500 and the container starts booting,
- requests from ~40s onward serve normally (~1s),
- the browser recovers on its own (socket.io reconnects, TanStack Query retries).

This is expected, not a fault. Verify with:

```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}\n" https://api.scadium.com/health   # may be 500
sleep 45
curl -s https://api.scadium.com/health/ready    # {"status":"ok","checks":{"database":"up","redis":"up"}}
```

To make it always-on (costs money on BOTH sides — see spec §8.4 and §8.6):
raise `SLEEP_AFTER` in `wrangler.jsonc` **and** move Neon off the free plan.

## Diagnosing

```bash
npx wrangler tail                          # Worker logs, live
npx wrangler containers list               # app state + live instances
npx wrangler containers instances <APP_ID> # per-instance state
```

- `The container is not listening in the TCP address …` → it is still booting. Wait.
- `The container is not running, consider calling start()` → same, earlier in the cycle.
- Every request `Canceled` in `wrangler tail` → your client timed out before the
  container finished booting; retry with a longer timeout.

### The container refuses to start at all (wedged Durable Object state)

Symptom: **every** request returns `The container is not running, consider calling
start()` in ~0.3s (a fast refusal, not a 20s timeout), `wrangler containers
instances` shows the instance `inactive`, and `containers info` reports
`active: 0, failed: 0, errors: []`. Redeploying does not help. **Reverting the
code that caused it does not help either** — that is the diagnostic tell.

Cause: the `Container` class persists lifecycle state in Durable Object storage
under `__CF_CONTAINER_STATE`. That state outlives your code. A hook that throws
where the library does not expect it — notably `onError()`, which runs on the
container monitor — can leave a status the library will never restart from.

Fix: rotate the instance name to allocate a fresh Durable Object.

```bash
# wrangler.jsonc → vars.CONTAINER_INSTANCE: "scadium-api-v2" → "scadium-api-v3"
npx wrangler deploy
```

Prevention: never throw from `onStart` / `onStop` / `onError`, and never replace
the library's fast-fail start with a long blocking `startAndWaitForPorts()` —
both were tried here and both made things worse.

## What the hourly cron actually does

`0 * * * *` → the Worker's `scheduled()` handler:

1. Wakes the container and POSTs once to `/api/v1/internal/jobs` (all 9 jobs).
2. **Retries up to 4 times, 30s apart.** The container is almost always cold when
   the cron fires and a cold start outlasts the container library's port wait, so
   the first attempt reliably fails while it boots. Without the retry the economy
   jobs would never run.
3. **Always calls `stop()` afterwards, even if the sweep failed** (it is in a
   `finally`). This is the single most important cost control in the deployment:

   | Cron behaviour | Unvisited runtime | Cost against the $5 plan |
   |---|---|---|
   | let it idle out (`SLEEP_AFTER`) | ~73 h/month | 8.8× over the 25 GiB-h included → ~$2/mo |
   | **stop when done** | ~10 h/month | inside every allotment → **$0** |

   It also keeps Neon's free 100 CU-hours from being eaten by an empty site
   (73 CU-h → 10 CU-h).

**Set `CRON_STOP_CONTAINER=false` once real players are online** — stopping the
container disconnects anyone mid-round. At that point the container is
effectively always-on, which also means Neon must move off the free plan.

Tunables: `CRON_SWEEP_ATTEMPTS` (4), `CRON_SWEEP_BACKOFF_MS` (30000).

## Daily active-time cap (the site goes offline when spent)

The container is capped at **`DAILY_ACTIVE_SECONDS` (default 3600 = 1 hour) of
active time per UTC day**. Past it, `api.scadium.com` returns 503 with
`Retry-After` and the live games are offline until midnight UTC. The web pages
themselves keep serving — only the API is gated.

This exists because both container billing and Neon's free compute-hours track
how long the container is awake, and without a ceiling a crawler or a handful of
visitors could keep it running all day.

```bash
curl -s https://api.scadium.com/api/v1/crash/snapshot | jq .
# when spent:
# { "statusCode": 503, "message": "Scadium is paused for today...",
#   "dailyActiveSecondsUsed": 3601, "dailyActiveSecondsCap": 3600,
#   "resumesAt": "YYYY-MM-DDT24:00:00Z" }
```

Notes:
- `/health` is exempt, so the service stays observable while capped.
- The check **fails open**: it is a cost guard, not a security control, so a
  transient Durable Object error logs loudly and lets the request through rather
  than taking the site down.
- Accounting is conservative (a wake is charged a full 40s cold start), so the
  real spend is at or below the cap, never above.
- The hourly cron **records** its own runtime against the same budget but is never
  **blocked** by it. The economy jobs are period-keyed, so a skipped hour is a
  permanent gap in airdrops/dividends/block-mining rather than something that
  catches up later. Budget for it: the cron uses roughly 24 min/day of the hour.
- Raise it, or set it very high, when the project is ready to be always-on —
  but remember that also requires moving Neon off the free plan.

## Running the economy jobs by hand

```bash
curl -X POST -H "x-internal-secret: $INTERNAL_JOB_SECRET" \
     -H 'content-type: application/json' -d '{}' \
     https://api.scadium.com/api/v1/internal/jobs          # all 9
curl -X POST -H "x-internal-secret: $INTERNAL_JOB_SECRET" \
     https://api.scadium.com/api/v1/internal/jobs/reconcile # one
```

Returns 403 without the secret, 400 for an unknown job name. The route is also
blocked at the Worker, so it is only reachable from the scheduled handler.

## Restart safety

The container can be killed at any moment — Cloudflare states no instance is
guaranteed to run for any period. This is safe: boot recovery settles stranded
rounds. Verified by SIGKILL mid-round, which produced:

```
crash recovery: 1 stranded round(s) — settling
lottery recovery: 1 stranded draw(s) — settling
jackpot recovery: 1 stranded round(s) — settling
```

with no double settlement.
