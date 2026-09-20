# Cloudflare Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Get `scadium.com` and `api.scadium.com` serving entirely from Cloudflare, with zero
Railway headers, the money core untouched, and marginal spend under $1/mo.

**Architecture:** `apps/api` + `apps/worker` run as a single Cloudflare Container (one Node
image, `PROCESS_MODE=both`, Redis on `localhost`), fronted by a Worker + Durable Object that
proxies HTTP and WebSockets. `apps/web` deploys to Workers via OpenNext. Cloudflare Cron
Triggers drive the 9 economy jobs through one generic secret-guarded endpoint. R2 holds avatars.
Postgres stays on Neon (Cloudflare has no equivalent).

**Tech Stack:** Cloudflare Containers / Workers / Durable Objects / Cron Triggers / R2 /
Turnstile / WAF · NestJS 11 · Next.js 16 · Prisma 5 · BullMQ · wrangler 4

**Spec:** `docs/superpowers/specs/2026-09-20-cloudflare-migration-design.md`

## Global Constraints

- **Money core is untouched.** No edits under `apps/api/src/games/**`, `apps/api/prisma/**`,
  or to `apply-balance-delta.ts` / `settle-claim.ts` / `with-serializable.ts` / `idempotency.ts`.
- **No hardcoded values.** Hosts, ports, secrets, instance type, `sleepAfter`, cron cadence and
  job names are configuration with documented defaults.
- **No credentials in source.** Secrets via `wrangler secret` / Secrets Store only.
- **Cloudflare first.** A non-Cloudflare dependency requires a written justification in the spec.
- **One generic endpoint**, not one per job (house rule).
- Container instance type: `basic` (1/4 vCPU, 1 GiB, 4 GB disk). Image must be `linux/amd64`.
- Before anything lands on `main`: build + typecheck + lint + unit + integration + a fresh
  `prisma migrate deploy`, and a secret scan of the diff.

## Blocking prerequisite (owner action, one item)

`DATABASE_URL` for the Neon project `scadium-devnet` is **not on this machine** (the local
`.env` is all `localhost`). It is needed only at Task 6. Retrieve from the Neon dashboard or
`neonctl connection-string --project-id <id>`. Everything up to Task 6 proceeds without it.

---

### Task 1: One container image, `PROCESS_MODE`, in-container Redis

**Files:**
- Modify: `apps/api/Dockerfile`
- Modify: `apps/api/docker-entrypoint.sh`
- Test: `apps/api/test/process-mode.spec.ts` (new)

**Interfaces:**
- Produces: an image that runs `api`, `worker`, or `both` per `PROCESS_MODE` (default `api`),
  with `redis-server` on `127.0.0.1:6379` when `REDIS_URL` is unset.

- [ ] **Step 1:** Add `redis` to the runner stage apk install; copy `apps/worker/dist` +
      `apps/worker/node_modules` into the runner (mirroring `apps/worker/Dockerfile`).
- [ ] **Step 2:** Rewrite `docker-entrypoint.sh` to: start `redis-server --save '' --appendonly no`
      in the background when `REDIS_URL` is unset; run `prisma migrate deploy`; then start
      processes per `PROCESS_MODE`; propagate SIGTERM to all children.
- [ ] **Step 3:** `docker build --platform linux/amd64 -f apps/api/Dockerfile -t scadium-api:cf .`
- [ ] **Step 4:** Run it against docker-compose Postgres with `PROCESS_MODE=both`; assert
      `/health` is 200 and the logs show both `Scadium API running` and `worker up — 9 queues`.
- [ ] **Step 5:** Commit.

---

### Task 2: Generic job-trigger endpoint

**Files:**
- Create: `apps/api/src/jobs/jobs.controller.ts`, `jobs.module.ts`, `job-registry.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/jobs/job-registry.spec.ts`

**Interfaces:**
- Produces: `POST /internal/jobs/:name`, guarded by header `x-internal-secret` ===
  `INTERNAL_JOB_SECRET`. `:name` ∈ the 9 `QUEUE_NAMES` values. Returns 202 on dispatch,
  401 without the secret, 404 for an unknown name.
- Consumes: the existing services — no new business logic.

- [ ] **Step 1:** Write `job-registry.spec.ts` asserting the registry key set equals
      `Object.values(QUEUE_NAMES)` — so a new queue cannot be added without a handler.
- [ ] **Step 2:** Run it; expect FAIL (module missing).
- [ ] **Step 3:** Implement `job-registry.ts` as a `Record<QueueName, (deps) => Promise<void>>`
      built from the same calls in `apps/worker/src/main.ts:47-135`. No copied logic.
- [ ] **Step 4:** Implement the controller + module; register in `app.module.ts`; exclude
      `internal` from the global `api/v1` prefix.
- [ ] **Step 5:** Run unit tests + `tsc --noEmit`; expect PASS.
- [ ] **Step 6:** Curl all 9 names against the local container: 202 with the secret, 401 without.
- [ ] **Step 7:** Commit.

---

### Task 3: Wrangler config, front-door Worker, Durable Object

**Files:**
- Create: `wrangler.jsonc`, `worker/index.ts`, `worker/container.ts`
- Create: `.dev.vars.example`

**Interfaces:**
- Produces: `ScadiumApi` (extends `Container`), `defaultPort = 4000`,
  `sleepAfter` from `SLEEP_AFTER` (default `"2m"`). Default export forwards every request to
  `getContainer(env.SCADIUM_API).fetch(request)` — **`fetch`, not `containerFetch`**, so
  WebSocket upgrades proxy.

- [ ] **Step 1:** `pnpm add -w -D wrangler@4 @cloudflare/containers`
- [ ] **Step 2:** Write `wrangler.jsonc`: `containers` block pointing at
      `apps/api/Dockerfile`, `instance_type: "basic"`, the DO migration
      (`new_sqlite_classes: ["ScadiumApi"]`), `compatibility_date`, observability on.
- [ ] **Step 3:** Write `worker/container.ts` and `worker/index.ts`.
- [ ] **Step 4:** `npx wrangler deploy --dry-run` — expect success.
- [ ] **Step 5:** Commit.

---

### Task 4: Cron Trigger for the 9 jobs

**Files:**
- Modify: `wrangler.jsonc` (add `triggers.crons`)
- Modify: `worker/index.ts` (add `scheduled` handler)

**Interfaces:**
- Produces: a `scheduled()` handler that POSTs each job name to
  `/internal/jobs/:name` with the `x-internal-secret` header, sequentially, logging failures
  without aborting the rest.

- [ ] **Step 1:** Add `"triggers": { "crons": ["0 * * * *"] }`.
- [ ] **Step 2:** Implement `scheduled()` iterating the 9 names from one shared constant.
- [ ] **Step 3:** `npx wrangler deploy --dry-run`; then verify locally with
      `wrangler dev --test-scheduled` and `curl "http://localhost:8787/__scheduled"`.
- [ ] **Step 4:** Commit.

---

### Task 5: Prove the restart-safety risk (spec §8.2)

**Files:**
- Create: `docs/runbooks/container-restart-drill.md`

- [ ] **Step 1:** Start the local container, place a crash bet, and `docker kill --signal=SIGTERM`
      mid-round.
- [ ] **Step 2:** Restart; assert via psql/Prisma that the round is terminal, the bet is refunded
      or settled exactly once, and `BalanceLedger` shows no double credit.
- [ ] **Step 3:** Repeat with `SIGKILL` (no graceful shutdown) — the harsher case.
- [ ] **Step 4:** Record the results in the runbook. If either fails, **stop and fix before deploying.**
- [ ] **Step 5:** Commit.

---

### Task 6: First deploy — container live on Cloudflare

**Blocked on:** the owner's Neon `DATABASE_URL`.

- [ ] **Step 1:** Generate secrets: `openssl rand -hex 48` for `JWT_SECRET`,
      `INTERNAL_JOB_SECRET`, `METRICS_TOKEN`, `GEO_IP_SALT`, `GEO_PROXY_SECRET`. Never echo them.
- [ ] **Step 2:** `npx wrangler secret put <NAME>` for each, plus `DATABASE_URL`.
- [ ] **Step 3:** `npx wrangler deploy` (builds and pushes the image).
- [ ] **Step 4:** Smoke: `/health` 200, `/health/ready` 200, migrations applied on boot.
- [ ] **Step 5:** Trigger one job via cron and confirm it ran.
- [ ] **Step 6:** Commit.

---

### Task 7: `apps/web` on Workers via OpenNext

**Files:**
- Create: `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1:** `pnpm --filter @scadium/web add -D @opennextjs/cloudflare`
- [ ] **Step 2:** Write `open-next.config.ts` + `wrangler.jsonc` (assets binding, nodejs_compat).
- [ ] **Step 3:** Build with `NEXT_PUBLIC_API_URL=https://api.scadium.com` and
      `NEXT_PUBLIC_WS_URL=wss://api.scadium.com`.
- [ ] **Step 4:** `npx opennextjs-cloudflare build && npx opennextjs-cloudflare deploy`
- [ ] **Step 5:** Smoke `/crash`, `/coinflip`, `/blackjack` on the workers.dev URL.
- [ ] **Step 6:** Commit.

---

### Task 8: R2 for avatars

**Files:**
- Create: `apps/api/src/storage/r2.service.ts`, `storage.module.ts`
- Modify: `apps/api/src/users/users.service.ts`, `users/dto/update-profile.dto.ts`

- [ ] **Step 1:** `npx wrangler r2 bucket create scadium-avatars`
- [ ] **Step 2:** Write a failing test: uploading an avatar stores an R2 key, not a data URL.
- [ ] **Step 3:** Implement `R2Service` using the S3-compatible API with credentials from env.
- [ ] **Step 4:** Switch the profile update path to R2; keep the size/type validation and the
      SVG rejection exactly as-is (it is an XSS guard).
- [ ] **Step 5:** Update the comment at `update-profile.dto.ts:16` — the deferred fix is now done.
- [ ] **Step 6:** Tests green; commit.

---

### Task 9: Edge hardening

- [ ] **Step 1:** Add the `ratelimit` binding to `wrangler.jsonc`; apply it in `worker/index.ts`
      to `/api/v1/auth/*` before forwarding.
- [ ] **Step 2:** Create a WAF rate-limiting rule on the zone for `/api/v1/auth/*`.
- [ ] **Step 3:** Turn on Bot Fight Mode; set SSL to Full (strict); enable Always Use HTTPS + HSTS.
- [ ] **Step 4:** Transform Rule injecting `x-geo-proxy-secret` on requests to the API host,
      stripping any client-supplied value.
- [ ] **Step 5:** Block `/metrics` at the edge except from an allowlist; keep `METRICS_TOKEN`.
- [ ] **Step 6:** Commit the config-as-documentation into `docs/runbooks/cloudflare-edge.md`.

---

### Task 10: DNS cutover and Railway removal

- [ ] **Step 1:** Point `scadium.com` + `www` at the web Worker; `api` at the API Worker
      (Workers routes / custom domains). Remove the stale Railway CNAME and its
      `_railway-verify` TXT records.
- [ ] **Step 2:** Verify: `curl -sI https://scadium.com | grep -i railway` returns **nothing**.
- [ ] **Step 3:** Rebuild the web Worker with the final `NEXT_PUBLIC_*` origins; set
      `CORS_ORIGIN=https://scadium.com` on the API.
- [ ] **Step 4:** End-to-end: connect wallet, place a crash bet, cash out, see live WS ticks.
- [ ] **Step 5:** Strip Railway from the 4 source comments; delete `render.yaml` if unwanted;
      update `CLAUDE.md`, `CHANGELOG.md`, `BACKLOG.md`, `DEPLOYMENT.md`.
- [ ] **Step 6:** Full local CI-equivalent suite; secret-scan; commit; push.

---

## Definition of done (from spec §9)

1. `scadium.com` + `api.scadium.com` serve from Cloudflare, zero Railway headers.
2. Crash, coinflip, blackjack playable end-to-end including live WebSocket updates.
3. Container sleeps when idle; woken by player traffic and by the hourly cron.
4. All 9 economy jobs demonstrably run after a sleep period.
5. A mid-round container kill leaves no stranded bets and no double settlement.
6. Full local CI-equivalent suite green.
7. Marginal Cloudflare spend for a pre-launch month under $1.
