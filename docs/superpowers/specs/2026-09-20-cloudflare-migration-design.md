# Scadium — Migration to Cloudflare (design)

**Date:** 2026-09-20 · **Status:** approved design, not yet implemented
**Supersedes:** `docs/deployment-architecture.md` (2026-07-16), which chose Railway.

## 1. Why this document exists

The owner's requirement: **get off Railway entirely and run Scadium on Cloudflare.**
Two constraints shape every decision below:

1. **Zero budget.** Free tiers only, except the **$5/mo Workers Paid plan that is already
   being paid** on the `gmcftci@gmail.com` account (shared with the eksenart projects).
2. **Cloudflare first, always.** Where Cloudflare offers a capability, Cloudflare is used.
   A third-party free tier is permitted **only** where Cloudflare genuinely offers nothing.

`docs/deployment-architecture.md` evaluated "everything on Cloudflare compute" in July 2026
and rejected it, on the grounds that it meant a months-long Durable Objects re-architecture of
the 20 Hz crash loop, the Socket.io gateways and the BullMQ layer. **That reasoning is now
obsolete:** Cloudflare **Containers** runs a real long-lived Linux process, and is documented
as "Available on Workers Paid plan" — which this account already has. The rejected premise
("Cloudflare = Workers = rewrite") no longer holds.

*(The Containers docs do not carry an explicit GA/beta label; treat maturity as "documented,
supported, and plan-gated" rather than assuming a GA guarantee.)*

## 2. Ground truth established before designing

Verified live, not assumed:

| Fact | Evidence |
|---|---|
| **Railway is already gone** | `scadium-api-production.up.railway.app/health` → `{"code":404,"message":"Application not found"}` |
| **`scadium.com` is already a Cloudflare zone** | resolves to `172.67.134.143` / `104.21.6.64`; NS = `lars/sue.ns.cloudflare.com` |
| **…but still points at the dead Railway origin** | response carries `x-railway-fallback: true`, `x-railway-edge: cdg1` |
| **Workers Paid is active** | owner confirmed; `wrangler containers list` returns cleanly rather than a plan error |
| **Postgres already exists, free and migrated** | `DEPLOYMENT.md`: Neon project `scadium-devnet`, "created + **migrated**" |
| **Redis already exists, free** | `DEPLOYMENT.md`: Upstash `scadium-devnet` (us-east-1, TLS) |
| **The code already speaks Upstash** | `apps/api/src/queue/queue.connection.spec.ts:25` asserts the `upstash.io` TLS servername |
| **Every Railway reference in source is a comment** | `apps/api/src/main.ts:84,92`, `observability/metrics.controller.ts:18`, `users/dto/update-profile.dto.ts:16`, `apps/worker/src/main.ts:221` |

**Consequence: this is a greenfield deploy, not a cutover.** There is no live traffic to
protect and no rollback plan to write. Half the work — full NS delegation to Cloudflare — is done.

## 3. The database decision (the one that could have sunk this)

Cloudflare has **no first-party Postgres**. The question was therefore whether the ledger
could move to a Cloudflare-native store. A line-by-line analysis of the money core says no,
on three independent grounds, any one of which is fatal:

1. **D1 has no interactive transactions.** 31 `$transaction` closures branch in JavaScript
   mid-transaction. The pattern `updateMany(...) → if (count === 0) throw` *is* the money
   safety model: the atomic debit (`prisma/apply-balance-delta.ts:68`), the double-settle gate
   (`games/settle-claim.ts:44`), the late-entry orphan gate (`lottery.service.ts:303`,
   `jackpot.service.ts:114`) and the idempotency claim (`prisma/idempotency.ts:44`).
   D1 offers only `batch()` — a pre-built statement array with no reads, no branches and no
   conditional abort.
2. **BigInt silently corrupts.** D1 returns SQLite INTEGERs to JS as `number`, so values above
   2^53−1 round. `VaultPool.indexRay` defaults to `1e18` — **111× over the line**. Prisma
   *validates* `BigInt` against a sqlite datasource, so this passes CI and manifests as a
   share-price index that quietly mints and burns money.
3. **The schema does not compile.** Verified against this repo's own Prisma 5.22: a sqlite
   datasource rejects all 15 enums, all 5 scalar-list columns, all 11 Json columns and all 90
   `@db.Uuid` annotations. SQLite has no `ALTER TABLE ADD CONSTRAINT`, so the 7 non-negative
   balance CHECKs cannot be added. **Zero of 53 migrations survive.**

There is a fourth, strategic cost: the **313-case, 90-spec real-Postgres suite** would go green
while proving nothing — firing 20 concurrent bets at a single-writer SQLite file passes trivially.

**Decision: keep Postgres. Stay on Neon's free tier.** The only Postgres that bills through
Cloudflare is PlanetScale-via-Hyperdrive, which has **no free tier** (~$10/mo minimum);
revisit when there is a budget.

## 4. Cloudflare-first evaluation

### 4a. Needs where Cloudflare wins → Cloudflare is used

| Need | Was | Cloudflare | Phase |
|---|---|---|---|
| API + worker compute | Railway container | **Containers** | 1 |
| Web hosting / SSR | Railway | **Workers** + OpenNext + Static Assets | 1 |
| WebSocket transport | Caddy / Railway proxy | **Container `fetch()` WS proxy** | 1 |
| Single-writer coordination | Redis leader election | **Durable Objects** (inherent) | 1 |
| Job scheduling | BullMQ repeatable schedulers | **Cron Triggers** | 1 |
| Rate limiting | `common/throttler-redis.storage.ts` (Redis Lua) | **Workers `ratelimit` binding** (GA Sep 2025) + **WAF rate-limiting rule** | 1 |
| Avatar storage | base64 data-URLs **inside Postgres** | **R2** | 1 |
| Secrets | Railway variables | **Worker Secrets / Secrets Store** | 1 |
| DNS, CDN, SSL, WAF, DDoS | Cloudflare (already) | zone features | 1 |
| Bot / signup abuse | *nothing* | **Turnstile** (free, 20 widgets) + **Bot Fight Mode** (free, all plans) | 1 |
| Gating `/docs` + `/metrics` | `METRICS_TOKEN` only | **Cloudflare Access** — free-tier user allowance to be confirmed at implementation; token kept as defence-in-depth | 1 |
| Logs | pino + Sentry | **Workers Logs** — container logs stream here natively | 1 |
| Job queues | BullMQ + Redis | **Queues** (1M ops/mo included) | 2 |
| SIWS nonce store | Redis (in-memory mode exists) | **Durable Object** | 2 |
| Metrics | Prometheus `/metrics` | **Analytics Engine** | 2 |
| CI/CD | GitHub Actions | **Workers Builds** | deferred — GH Actions works |

### 4b. Where Cloudflare has nothing → free third party, explicitly transitional

| Need | Cloudflare options rejected | Fallback |
|---|---|---|
| **Postgres ledger** | D1 & DO-SQLite (§3); Hyperdrive is a pooler, not a database; PlanetScale has no free tier | **Neon free** (already migrated) |
| **Redis (phase 1 only)** | KV is eventually consistent — Cloudflare's own docs say never use it for a nonce check | **Upstash free** (already created) |

**Redis is transitional, not architectural.** All six of its uses have a Cloudflare answer:

| Redis use | Replacement | Effort |
|---|---|---|
| Socket.io Redis adapter | moot at 1 replica — delete | none |
| Leader election | moot — a container/DO is single-writer | none |
| Distributed locks (`redis/redis-lock.ts`) | moot at 1 replica; DO if ever >1 | none |
| Throttler | **`ratelimit` binding** | small (phase 1) |
| SIWS nonces | **Durable Object** | small (phase 2) |
| BullMQ × 9 queues | **Queues + Cron Triggers** | medium (phase 2) |

After phase 2, **Redis and the Upstash dependency are deleted.**

### 4c. Cloudflare products evaluated and deliberately not used

**Hyperdrive** — exists to give *Workers* a pooled TCP hop to Postgres; the container connects
directly, so it is a hop for no benefit. Revisit only if a Worker ever queries Postgres.
**D1** — disqualified for the ledger (§3); acceptable later for throwaway analytics.
**KV** — eventually consistent; config/feature flags only, never nonces or balances.
**Pages** — legacy path for Next.js; Workers is current. **Images** — paid; R2 suffices.
**Workers for Platforms** — multi-tenant product, irrelevant to a single app.
**Workers VPC / Tunnel** — no private origin to reach.
**Stream, Vectorize, Workers AI, AI Gateway, Browser Rendering, Sandbox SDK, Realtime/WebRTC,
Email Routing, Waiting Room, Load Balancing, Argo, Spectrum, Zaraz** — no matching need (YAGNI).

## 5. Architecture

```
                   scadium.com  (Cloudflare zone — NS delegated, already proxying)
                            |
        +-------------------+--------------------+
        |                                        |
  scadium.com / www                        api.scadium.com
  Worker: Next.js via OpenNext             Worker: front door
  + Workers Static Assets                        |
        |                                  ScadiumApi (Durable Object)
        |                                        |  container binding
        |                                 +------+--------+
        |                                 |  Container    |  node:20-alpine
        |                                 |  NestJS API   |  PROCESS_MODE=both
        |                                 |  + BullMQ wkr |  instance: basic (1 GiB)
        |                                 +------+--------+
        |   fetch + WebSocket upgrade            |
        +----------------------------------------+
                                                 |
   Cron Trigger (hourly) --wake-->               |
                              +------------------+-------------------+
                         Neon Postgres      Upstash Redis          R2
                         free - TCP         free - TLS        avatars
```

### 5.1 One container, not two

The API must run at **exactly 1 replica** regardless of platform: leader election has no
request-forwarding, so followers reject ~(N−1)/N of gameplay writes (the H12 caveat recorded in
`docs/deployment-architecture.md`). `apps/worker` is a 257-line bootstrap that boots
`WorkerModule` from `@scadium/api` — the same code in a second process. Two containers would
double the memory bill and both would need waking.

**Reuse:** `apps/worker/Dockerfile` already builds *both* `apps/api/dist` and
`apps/worker/dist` into one image.
**Genuinely new:** a `PROCESS_MODE` environment variable (`api` | `worker` | `both`,
default `api`) selected in `apps/api/docker-entrypoint.sh`.

This is config-driven rather than a forked Dockerfile, and splitting back into two containers
later is a **wrangler configuration change, not a code change** (OCP).

### 5.2 How the 9 economy jobs run without an always-on worker

`apps/worker` exists today purely to be awake when 9 repeatable schedulers fire. Instead:

> **Cron Trigger (hourly) → `GET /health` on the container → container wakes → BullMQ drains
> overdue delayed jobs → container sleeps again after `sleepAfter`.**

This is expected to work because BullMQ's repeatable schedulers materialise as *delayed jobs in
Redis*, which Upstash persists while the container is down. Every job is already idempotent and
period-keyed (`AirdropPool.distributed`, `DistributionRound.period`, the `RaceResult` unique
guard), so late execution is safe by construction. `apps/worker/src/main.ts:220-225` already
opens a health port when `PORT` is set, so no new endpoint is required.

**This assumption is unproven and must be verified before it is relied upon** — see §8, risk 1.

### 5.3 Web on Workers

`apps/web` is the cleanest piece in the repo for this: **zero `node:` imports** anywhere under
`src`, `images.remotePatterns: []`, no custom `output` mode, no rewrites, no route handlers, no
`'use server'` actions, and `middleware.ts` **already reads `cf-ipcountry`**. It deploys to
Workers via `@opennextjs/cloudflare` — the same adapter already chosen over beta `vinext` on the
ModaKatre project, so it is not a new tool for this owner.

Static assets ride Workers Static Assets (free, unmetered). Repointing the API is configuration
only: `apps/web/src/config/env.ts` reads `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` with no
hardcoded hosts.

### 5.4 Front door Worker and WebSockets

A thin Worker on `api.scadium.com` forwards to the container's Durable Object stub via
`fetch()` — **the only method that proxies WebSocket upgrades** (`containerFetch()` does not).
All 8 Socket.io gateways therefore work unchanged, and the 3 client files that touch
`socket.io-client` (`providers/socket-provider.tsx`, `hooks/use-crash.ts`, `hooks/use-chat.ts`)
are untouched.

### 5.5 Configuration and secrets

No value that an operator might change may be baked into an image. `JWT_SECRET`,
`DATABASE_URL`, `REDIS_URL`, `METRICS_TOKEN`, `GEO_IP_SALT`, `GEO_PROXY_SECRET`,
`PROCESS_MODE`, the container instance type and `sleepAfter` are all Worker secrets or
`wrangler.jsonc` settings with documented defaults. Secrets are generated with `openssl rand`
and never printed or committed. `GEO_PROXY_SECRET` is injected by a Cloudflare Transform Rule
and stripped from any client-supplied value.

## 6. What changes in the repository

| Change | Size | Kind |
|---|---|---|
| `wrangler.jsonc` + front-door Worker + `ScadiumApi` DO class | ~80 lines | new |
| `PROCESS_MODE` in `apps/api/docker-entrypoint.sh`; consolidate to one image | small | extend |
| Container lifecycle policy (`sleepAfter`, `onActivityExpired`) | small | new |
| Cron Trigger Worker | ~15 lines | new |
| `apps/web`: add `@opennextjs/cloudflare` + its `wrangler.jsonc` | small | extend |
| Rate limiting → `ratelimit` binding (app throttler kept as defence-in-depth) | small | extend |
| Avatars → R2 (closes `users/dto/update-profile.dto.ts:16`) | medium | new |
| Turnstile on signup; Bot Fight Mode; Access on `/docs` + `/metrics` | small | new |
| Strip Railway from 4 source comments; supersede `docs/deployment-architecture.md` | docs | edit |
| **`apps/api/src/games/**`, `apps/api/prisma/**` (53 migrations), the 313-case suite** | **none** | **untouched** |

## 7. Cost model

Containers bill per 10 ms of *active* runtime. The Workers Paid plan already includes
**25 GiB-hours memory, 375 vCPU-minutes CPU and 200 GB-hours disk** per month.
On the `basic` instance type (1/4 vCPU, 1 GiB memory, 4 GB disk), memory binds first:
25 GiB-h ÷ 1 GiB = **25 free container-hours per month**.

| Mode | Runtime | Marginal cost |
|---|---|---|
| Cron-wake hourly, `sleepAfter = 2m` | ~24 h/mo | **$0** (inside the included allotment) |
| Cron-wake hourly, `sleepAfter = 10m` (default) | ~122 h/mo | **~$0.94/mo** |
| Pinned always-on 24/7 (post-launch) | 730 h/mo | **~$8.17/mo** — *and forces a paid Postgres plan, see §8.4* |

| Line item | Cost |
|---|---|
| Workers Paid | **$5/mo — already being paid** |
| Container (pre-launch) | **< $1/mo** |
| Neon Postgres, Upstash Redis, R2, DNS/CDN/WAF, Turnstile, Access | **$0** |
| Railway | **deleted (−$20–27/mo)** |

## 8. Risks, and what must be proven before it is trusted

1. **BullMQ overdue-job drain (unproven).** §5.2 assumes a returning worker processes delayed
   jobs whose time passed while it was down. **Must be proven locally against
   `infra/docker-compose.yml` before the cron-wake design is relied upon.** If it does not
   hold, the fallback is a cron Worker that calls an admin trigger endpoint per job — more
   code, but no correctness risk.
2. **Container restarts are not guaranteed-free.** Cloudflare states plainly that it "does not
   guarantee that any container instance will run for any set period of time"; host restarts
   occur on an irregular cadence (SIGTERM, 15-minute grace, then SIGKILL). The crash engine
   already handles this via `recoverStrandedRounds()` + `recoverScheduledBets()`
   (`crash.engine.ts:1004`) and `app.enableShutdownHooks()` (`main.ts:90`). **Verify by killing
   the container mid-round and asserting no stranded bets and no double settlement.**
3. **WebSockets drop on every deploy.** True on any platform. The crash client's missing
   reconnect-resync (H16) leaves a live bet with the cash-out button disabled after a drop.
   **Flagged, not silently absorbed into this migration's scope.**
4. **Neon free tier limits are tighter than they first appear (verified against Neon's
   pricing page) — and one of them blocks the 24/7 end state.**
   - **0.5 GB storage per project**, and exceeding it **blocks writes** rather than billing
     overage. For a ledger, blocked writes are a hard outage. Moving avatars out of Postgres
     into R2 is therefore not cosmetic — it protects the quota.
   - **100 CU-hours per project per month.** Neon auto-suspends after 5 minutes idle and this
     **cannot be disabled on Free**. That suits a *sleeping* container, but it means
     **Neon Free cannot support a pinned always-on 24/7 API**, which would need ~730
     compute-hours. Pinning the container always-on (§7) therefore also forces a Neon paid
     plan or another provider. **Phase 1 must stay on the sleep/cron-wake model.**
   - **No point-in-time restore on Free** — only a 6-hour history window (1 GB limit).
     A hardened Postgres with real PITR remains a **real-money prerequisite**, as already
     recorded in the real-money checklist.
5. **Upstash free tier has a daily command ceiling.** At 1 replica, leader election and the
   Socket.io adapter become unnecessary and should be disabled to cut command volume.
6. **Cold start.** A woken container costs 1–3 s plus NestJS boot. Acceptable pre-launch;
   pin the container always-on once there are real players.

## 9. Success criteria

1. `scadium.com` and `api.scadium.com` serve from Cloudflare, with **zero** Railway headers.
2. Crash, coinflip and blackjack are playable end-to-end, including live WebSocket updates.
3. The container sleeps when idle and is woken by both player traffic and the hourly cron.
4. All 9 economy jobs demonstrably run after a sleep period.
5. A mid-round container kill leaves no stranded bets and no double settlement.
6. Full local CI-equivalent suite green: build, typecheck, lint, unit, integration, a fresh
   `prisma migrate deploy`, and the secret scan.
7. Marginal Cloudflare spend for a pre-launch month is under $1.

## 10. Explicitly out of scope

Real-money enablement; the on-chain/mainnet cutover; the Phase 0 audit findings; the H16
reconnect-resync fix (flagged, not fixed here); any change to game logic, fairness derivation,
the Prisma schema or the money core.

## 11. Phasing

- **Phase 1 — off Railway, onto Cloudflare.** Everything in §6. Neon + Upstash carry the
  stateful bits. The money core is not touched.
- **Phase 2 — shrink to Cloudflare-only.** BullMQ → Queues; SIWS nonces → Durable Object;
  Prometheus → Analytics Engine; then **delete Redis and the Upstash dependency**.
  Postgres stays on Neon, because Cloudflare has no answer at any price below ~$10/mo.
