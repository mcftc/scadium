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
