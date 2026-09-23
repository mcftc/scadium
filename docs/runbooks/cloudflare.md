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

### The container never restarts after it sleeps (state desync) — THE one to know

Symptom: the container runs perfectly after a deploy, then the first time it
sleeps every request fails with:

```
The container is not running, consider calling start()
```

and it never recovers until you redeploy.

**The tell:** that string is *not* one of the library's own errors — those read
`the container is not listening` or `there is no container instance that can be
provided to this durable object`. It comes from the **workerd runtime**.

So the Durable Object still believes the container is running and proxies
straight through, while the runtime knows it is gone. And because the object's
own view says "running", `startAndWaitForPorts()` skips starting — the two views
can never reconcile by themselves.

This is why several plausible-looking fixes only *appeared* to work: raising
`max_instances`, rotating `CONTAINER_INSTANCE`, and nudging `start()` each
forced a fresh Durable Object, and the very next sleep broke it again.

**Handled in code** (`worker/container.ts`): `ScadiumApi.fetch()` detects that
error, calls `destroy()` (SIGKILL + `onStop`, which clears the object's belief),
starts for real, and retries once.

**The subtlety that matters if you ever touch this:** the runtime usually does
*not* throw — it resolves with a **500 whose body** is that message. A plain
`try/catch` therefore never fires, which is exactly how the first attempt at
this fix shipped and did nothing. The code checks both shapes: a captured throw
*and* a cloned 500 body. WebSocket responses are excluded from the body check so
upgrades are never consumed. Timeouts are short and failures are swallowed
deliberately — a long await holds every request open, and rethrowing from this
path wedges the object.

Verified: after an 8-minute idle (the exact window that reliably broke it), the
first request returns 200.

If you ever see it again, check `worker/container.ts` still has that recovery
before suspecting anything else.

### The container never restarts after it stops (`max_instances` deadlock)

**Check this first** — it looks identical to the wedged-state failure below but
is far more common, and the fix is different.

Symptom: the container works once, then after it sleeps (or the cron stops it)
every request returns `The container is not running, consider calling start()`.

Diagnosis:

```bash
npx wrangler containers instances <APP_ID>
```

Stopped instances stay **registered** as `inactive`. If the number of registered
instances has reached `max_instances`, there is no slot left to schedule a new
container and it can never start again. A stale instance from an earlier
`CONTAINER_INSTANCE` name counts too — that is how this deployment ended up with
two registered instances against a cap of one.

Fix: raise `max_instances` in `wrangler.jsonc` and redeploy. It is **headroom,
not replicas** — the Worker addresses a single Durable Object by name, so exactly
one container ever serves, and the H12 single-replica constraint is enforced by
the DO identity rather than by this number.

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
- **What is charged is container *running* time**, sampled by a Durable Object
  heartbeat every `BUDGET_HEARTBEAT_SECONDS` (default 60) while the container is
  up. (Until 2026-09-23 it charged the gaps between HTTP requests — and an open
  WebSocket keeps the container awake with no requests, so one idle tab ran it
  nearly all day while the cap saw ~80 s an hour.) Once the cap is spent the
  heartbeat `stop()`s the container — SIGTERM, so crash drains its round first
  — and the edge returns 503. Overrun is bounded by one heartbeat interval.
- `BUDGET_EXEMPT_PATHS` (default `/health,/api/v1/crash/cashout`) stay reachable
  past the cap, so a player riding a crash round when it trips can still cash out
  while the container drains.
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

## CI

GitHub Actions currently **cannot run**: every job fails in ~2s with *"The job
was not started because your account is locked due to a billing issue."* That is
an account-level lock, not a repository or workflow problem, and it predates the
Cloudflare migration.

Until it is resolved, the local CI-equivalent is the gate (as `CLAUDE.md`
requires). Run all of it before pushing to `main`:

```bash
pnpm typecheck && pnpm typecheck:worker && pnpm lint
pnpm --filter @scadium/api test:unit

# integration needs a real Postgres; :5432 may be taken by another project
docker run -d --name scadium-testpg -p 5433:5432 \
  -e POSTGRES_USER=scadium -e POSTGRES_PASSWORD=scadium -e POSTGRES_DB=scadium_test postgres:16-alpine
docker compose -f infra/docker-compose.yml up -d redis
export TEST_DATABASE_URL='postgresql://scadium:scadium@localhost:5433/scadium_test?schema=public'
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @scadium/api exec prisma migrate deploy
pnpm --filter @scadium/api test:integration
```

Last full local run: typecheck 10/10, lint clean, **360 unit tests**,
**263 integration tests** (99 files) against real Postgres, 53/53 migrations.

## Game-loop settings (all optional; defaults in code)

Operator knobs for the round loops — change them without a rebuild by adding a
Worker var and redeploying (`worker/container.ts` forwards exactly this list,
`CONTAINER_TUNABLES`, to the container env).

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `SETTLE_TX_TIMEOUT_MS` / `SETTLE_TX_MAX_WAIT_MS` | 30000 / 10000 | Budget for a round's settle transaction (Prisma's own default is 5 s — too short for a busy round on Neon). |
| `SETTLE_RETRY_ATTEMPTS`, `SETTLE_RETRY_BASE_MS`, `SETTLE_RETRY_MAX_MS` | 4, 2000, 60000 | Settle retries with exponential backoff before the fallback (crash → refund via recovery; jackpot → refund; lottery keeps retrying). |
| `ROUND_WATCHDOG_INTERVAL_MS` / `ROUND_STALL_MS` | 10000 / 90000 | How often each loop is checked, and how long it may show no progress before it is resumed. |
| `CRASH_DRAIN_TIMEOUT_MS` | 120000 | On SIGTERM, how long crash may keep running to let the round in flight bust and settle (0 disables). |
| `FAIR_BEACON_ENABLED` | on | drand beacon for crash/jackpot/lottery (ADR 0004). Off = the older seed-only derivation. |
| `FAIR_BEACON_RELAYS` | api.drand.sh, drand.cloudflare.com, api2/api3.drand.sh | Relays tried in order. |
| `FAIR_BEACON_WAIT_MS` / `FAIR_BEACON_RELAY_TIMEOUT_MS` | 15000 / 2500 | How long past a round's publish time to keep trying; per-request timeout. |

The container needs outbound HTTPS to the beacon relays. If none answers in
time, crash **voids** the round and refunds it (log: `beacon round … no relay
answered`), the jackpot retries then refunds, and the lottery draw retries — none
falls back to a seed-only result.

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

**Correction (2026-09-23): the lottery line above was the H8 bug, not a
recovery.** The draw it settled was not due — recovery then settled every
`open` draw and overwrote its `drawAt`, and because the hourly cron boots the
container, production ran ~35 draws a day against a once-a-day schedule. Recovery
now settles only draws whose `drawAt` has passed and **resumes** the one that is
not due (`lottery recovery: resumed draw … draws at …`). A healthy restart log
shows that line, not "settling".
