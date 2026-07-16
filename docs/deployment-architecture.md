# Scadium — Deployment & Stack Decision (Phase 2)

**Date:** 2026-07-16 · **Inputs:** Phase 0 ground-truth audit (`docs/audit/phase-0-ground-truth.md`), the decision to **drop Vercel**, the owner's lean toward **Railway** for backend/DB/deploy, and the open **.NET 10 vs NestJS** question. Domain **scadium.com** is registered at Squarespace with **nameservers already delegated to Cloudflare** (full delegation).

This doc gives a **direct recommendation for each decision**, grounded in what the code actually needs. It supersedes the original "everything on Cloudflare compute" framing: the Phase 0 evidence and the Railway pivot point to a cleaner split — **Cloudflare at the edge, Railway for compute + data, stack unchanged.**

---

## TL;DR recommendation

| Decision | Recommendation | Why (one line) |
|---|---|---|
| **Backend host** | **Railway** (container-lift API + worker) | The backend is container-shaped (persistent 20 Hz loops, WS, BullMQ); Railway runs long-lived containers + managed data on a private network. |
| **Web host** | **Railway** (Next.js container) — *or* Cloudflare Workers/OpenNext if edge SSR is a priority | Everything on one platform is operationally simpler; Cloudflare CDN still fronts it. OpenNext is viable but adds caveats. |
| **Database** | **Railway Postgres**, **keep Prisma** | API connects directly over Railway's private network — no Hyperdrive/Neon needed (those exist to bridge Workers→Postgres, which we avoid). |
| **Redis** | **Railway Redis** | Hard dependency today (nonce store, throttler, Socket.io adapter, locks, leader election). |
| **Edge** | **Cloudflare** (DNS, WAF, CDN, DDoS, WS proxy) | Full NS delegation already done; sits in front of Railway with zero code changes. |
| **Backend stack** | **Keep NestJS + TypeScript.** Do **not** rewrite to .NET now. | None of the Phase 0 defects are language problems; a rewrite discards a mature, exceptionally-tested money system and re-introduces its risk. |
| **Object storage** | **Railway Bucket** (S3-compatible) for avatars | Fixes the 120 KB data-URL-in-Postgres finding cheaply. |

**Net:** Cloudflare edge + Railway (`web`, `api` ×1, `worker`, Postgres, Redis, bucket), NestJS/Prisma/TS unchanged. This sidesteps the entire Durable-Objects rewrite and fits the code as it is.

---

## 1. Web (`apps/web`, Next 16 App Router, React 19)

**Two viable paths.**

- **(A) Cloudflare Workers via `@opennextjs/cloudflare`** — the current, supported adapter (Pages is legacy for Next). Needs `nodejs_compat` + a recent compatibility date. Most App-Router features supported (SSR, PPR, `use cache`, image optimization via Cloudflare Images). **Caveats that matter for this app:** *Node.js-runtime middleware (Next 15.2+) is not yet supported* — the app's geo middleware (`middleware.ts`, reads `cf-ipcountry`) must stay on the **edge runtime** (the default), which it is; verify before committing. Wildcard `images.remotePatterns` in `next.config.mjs` becomes an open image-proxy on any host — lock it down. Best global TTFB.
- **(B) Railway (Next.js as a Node container)** — runs stock Next with zero adapter caveats; Cloudflare CDN/cache still fronts it for static/ISR assets. Simplest ops (one platform, one build system, one bill, same private network as the API). Slightly higher TTFB than edge SSR, mitigated by Cloudflare cache.

**Recommendation: (B) Railway for launch**, revisit (A) later if edge SSR latency becomes a priority. Rationale: with the backend already on Railway, colocating the web removes a whole platform's worth of build/deploy/observability surface and the OpenNext middleware/runtime caveats, for a latency cost Cloudflare's CDN largely erases on a game-first app that 307s `/`→`/crash`. The realtime client (Socket.io, websocket-only to the API origin) and Solana wallet-adapter are pure browser code and behave identically either way. **Independent of A/B, fix now:** `metadataBase` is hardcoded `https://scadium.io` → set to `https://scadium.com`; add `robots.txt`/sitemap/OG; lock `images.remotePatterns`.

## 2. Backend (`apps/api` + `apps/worker`)

The Phase 0 audit is unambiguous that this **does not lift to Workers**: a singleton 20 Hz in-memory crash loop, persistent Socket.io namespaces, a BullMQ worker over ioredis, native Prisma engine, `@solana/web3.js`, and `setTimeout` slot-polling all assume long-lived Node processes with local mutable state. The real fork:

- **(A) Container-lift to Railway (recommended).** Keep NestJS as-is. Deploy `api` and `worker` as two Railway services against managed Postgres + Redis on the private network; Cloudflare fronts for DNS/WAF/CDN and proxies WebSockets (Socket.io's ping keeps the connection under Cloudflare's ~100 s idle timeout). **Least rewrite, fits the code exactly.**
- **(B) Cloudflare-native Durable Objects.** Model each live round + chat room as a DO (single authoritative instance + WebSocket Hibernation), stateless REST on Workers, Cloudflare Queues + Cron Triggers for the 9 background jobs, Hyperdrive/Neon for Postgres. This *would* natively solve H12 (one authoritative instance per round) and make the API crash-recoverable — but it is a **months-long re-architecture** of the four in-memory engines, the BullMQ layer, and the ioredis leader-election model, and the DO caveats bite (a deploy disconnects all WebSockets — round-resume needed either way; a 20 Hz `setInterval` keeps a DO billably active — the tick cadence/duration would need redesign). **Not justified now.**

**Recommendation: (A) Railway container-lift.**

> **Load-bearing caveat — H12.** Leader election makes ≥2 API replicas *safe* but not *functional*: there's no request-forwarding to the leader, so follower pods reject ~(N-1)/N of gameplay writes. **Run the `api` service at exactly 1 replica on Railway** (the worker too, though its jobs are idempotent). This is fine for launch scale. If HA/horizontal scale is later needed, the choice is (i) add sticky routing / leader-forwarding to the existing engines, or (ii) adopt the DO model for the live-round surface only. Option (B) above is essentially "pay that cost now"; (A) defers it until there's traffic to justify it. Either way, **fix the crash client's missing reconnect-resync (H16)** first — a WS drop currently strands a live bet with the cash-out button disabled, and *every* deploy drops WebSockets.

## 3. Database

The code is **already PostgreSQL via Prisma** (`apps/api/prisma`, 50 migrations, BigInt money columns, append-only `BalanceLedger`, idempotency uniques). This is **not a DB migration** — only a managed-provider + connection decision:

- **Railway Postgres (recommended).** The `api`/`worker` containers connect directly over Railway's private network — low latency, no connection-pooling middleware needed at launch scale (add PgBouncer later if the connection count climbs). **Keep Prisma unchanged.**
- **Hyperdrive / Neon** exist to give *Cloudflare Workers* a pooled connection to an external Postgres. They're only relevant under backend option (B). Under (A) they add a hop for no benefit — skip them.

**Recommendation: Railway Postgres + Prisma, no Hyperdrive/Neon.** (If the backend ever moves to Workers, revisit — Prisma's driver adapter over Hyperdrive is the path then.)

## 4. Backend stack — .NET 10 vs NestJS/TypeScript

The owner is a C#/.NET developer and floated **.NET 10 + PostgreSQL** (dropping Prisma/NestJS). Evaluated from first principles against the Phase 0 evidence:

**The case *for* .NET (honest steelman):**
- The owner maintains this solo long-term; C#/Rider is their home turf, which is a real productivity and correctness factor over years.
- .NET 10 + EF Core/Dapper + ASP.NET Core is a first-class, high-performance stack for exactly this kind of transactional API.
- A single-language-team argument: no context-switch between TS and Rust… except the Solana programs stay Rust regardless.

**The case *against* a rewrite now (stronger, on the evidence):**
1. **No Phase 0 defect is a language problem.** The 5 critical / 32 high are logic, lifecycle, scheduling, and config bugs (blackjack bet-clearing, seed-rotation guard, coinflip TOCTOU, mid-hour job cadence, unwired settlement bridge). A rewrite re-solves every one from zero and adds a fresh crop of its own — on a system that *moves money*.
2. **It discards a genuinely production-grade, unusually well-tested money core.** `applyBalanceDelta` guarded-CAS + `withSerializable` + `settle-claim` status-CAS + Redis leader election with **kill-9 chaos recovery**, backed by **90 real-Postgres e2e tests** (50-way balance races, 20-way double-spend, coinflip-race, blackjack double-settle) that I partially re-proved live. All of that would be reimplemented and re-earned in C# — months of work to get *back* to today's correctness, before adding any value.
3. **It breaks the fair-engine parity story.** The provably-fair engine already runs **byte-identically in Node, the browser (WebCrypto), and Rust**, locked by golden fixtures in CI. The browser verifier is and stays JavaScript. A .NET server adds a **fourth** implementation that must stay byte-for-byte identical to the browser's — and the audit found the golden fixture is only 3 vectors, omits dice/limbo/wheel/plinko, and one game (limbo edge) *already drifted once*. More surface for a fairness divergence that a player could exploit or that breaks client-side verification — for zero functional gain.
4. **Solana tooling is TypeScript-first.** `@solana/web3.js`, the Anchor TS client, the committed IDL/types, and the hand-encoded borsh in `chain.service.ts` are all TS. .NET means Solnet (less mature) and re-deriving the entire chain layer.
5. **Dropping Prisma is its own large rewrite** — the data layer, the guarded-debit primitive, and 50 migrations move to EF Core/Dapper, re-validated against the money invariants.

**Recommendation: keep NestJS + TypeScript + Prisma.** The engineering time between here and a real-money launch is enormous (fix 5 criticals, wire real-money gating, complete the audit) and should go into *that*, not into re-deriving a working casino backend in a new language. **If .NET is a hard long-term requirement**, do it as a *later* strangler-fig — extract **new, stateless** services in .NET behind the same API gateway, never rewriting the money/game/fairness core — and only after the Phase 0 bugs are closed and real money is stable. A big-bang rewrite now trades a known, tested system for an unknown one, on the one kind of app where that trade is least forgivable.

## 5. Registrar / DNS cutover (scadium.com)

Nameservers are **already delegated to Cloudflare** (full delegation — the recommended path over partial/CNAME setup, since it unlocks the full proxy/WAF/cache/rules feature set and simplifies the Railway origin records). Remaining steps at cutover:
- In Cloudflare DNS, add **proxied (orange-cloud)** records pointing the web + api hostnames at their Railway service domains (Railway issues a `*.up.railway.app` domain per service; add the custom domain on the Railway side and the CNAME on the Cloudflare side).
- Keep the api hostname proxied so WAF + WS proxy apply; ensure `trust proxy` in `main.ts` is set for the CF→Railway hop count (today it's `trust proxy: 1` — validate against the real chain), and that the geo trusted-proxy secret header is injected by Cloudflare (a Transform Rule) and stripped from client-supplied values.
- Cloudflare settings: SSL **Full (strict)**, WAF managed rules on, cache rules for `apps/web` static/ISR, a rate-limiting rule in front of `/api/v1/auth/*` (belt-and-suspenders over the app throttler).

---

## Decisions (confirmed 2026-07-16)

1. **Stack:** ✅ **Keep NestJS + TypeScript + Prisma.** No .NET rewrite. If .NET is wanted long-term, strangler-fig for new stateless services only, after the money bugs are closed.
2. **Web host:** ✅ **Railway** (Next.js container, Cloudflare CDN in front).
3. **Backend host:** ✅ **Railway container-lift** (`api` ×1 + `worker`), Cloudflare edge in front.
4. **DB/Redis:** ✅ Railway Postgres + Redis, keep Prisma, no Hyperdrive/Neon.
5. **First work:** ✅ Tier 1 play-money bug fixes (`BACKLOG.md`), before the platform cutover.

Work proceeds **without GitHub issues** (owner's process change): `BACKLOG.md` = plan, `CHANGELOG.md` = shipped, `CLAUDE.md` stays current, implemented directly against those.

---

## Railway provisioning status (2026-07-16)

**Project created:** `scadium` (id `91d0472a-a626-4308-b6d1-afb51b205cac`), env `production`, workspace "Muhammed Ciftci's Projects".
**Provisioned:** managed **Postgres** (`d16f6cf9-…`) + **Redis** (`7dafa24c-…`).

**⛔ Blocked:** creating the app compute services (`scadium-api`, `scadium-worker`, `scadium-web`) returns *"Free plan resource provision limit exceeded — please upgrade."* Deploying the app needs a **paid Railway plan** (Hobby is enough). That's a billing decision for the owner; everything below is turnkey once upgraded.

### Deploy runbook (after upgrading the plan)

All commands from the repo root with `RAILWAY_API_TOKEN` exported and the project linked (`railway link --project 91d0472a-a626-4308-b6d1-afb51b205cac --environment production`). The Dockerfiles build from the repo root, so each service uses the repo as build context and its own Dockerfile path.

1. **API** (`apps/api`, runs `prisma migrate deploy` on boot via `docker-entrypoint.sh`):
   ```bash
   railway add --service scadium-api
   railway variable set --service scadium-api \
     RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile \
     NODE_ENV=production \
     DATABASE_URL='${{Postgres.DATABASE_URL}}' \
     REDIS_URL='${{Redis.REDIS_URL}}' \
     JWT_SECRET='<64+ random bytes — NOT the .env.example placeholder (#H15/#33)>' \
     CORS_ORIGIN='https://scadium.com' \
     GEO_IP_SALT='<random>' GEO_PROXY_SECRET='<random, also set as a Cloudflare Transform Rule header>'
   railway up --service scadium-api          # uploads the working tree, builds the Dockerfile
   railway domain --service scadium-api      # generates a *.up.railway.app origin
   ```
2. **Worker** (`apps/worker`, no public domain — background queues): same as API but
   `RAILWAY_DOCKERFILE_PATH=apps/worker/Dockerfile`, same `DATABASE_URL`/`REDIS_URL`/secrets, **no** domain. Keep **replicas = 1** for the API (H12: leader election has no request-forwarding); the worker is idempotent so ≥1 is safe.
3. **Web** (`apps/web`, Next.js container): `RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile`,
   `NEXT_PUBLIC_API_URL=https://api.scadium.com`, `NEXT_PUBLIC_WS_URL=wss://api.scadium.com`,
   `NEXT_PUBLIC_SOLANA_NETWORK=devnet` (mainnet only with an explicit RPC), then `railway up` + `railway domain`.

### Cloudflare cutover (scadium.com — NS already delegated)

Once the Railway origins exist:
1. Cloudflare DNS → **proxied (orange-cloud)** CNAMEs: `scadium.com`/`www` → the web service's `*.up.railway.app`; `api` → the API service's origin. Add both custom domains on the Railway side too.
2. SSL/TLS → **Full (strict)**; WAF managed rules on; a rate-limiting rule in front of `/api/v1/auth/*`.
3. A **Transform Rule** that injects the `x-geo-proxy-secret` header (matching `GEO_PROXY_SECRET`) on requests to the API host, and strips any client-supplied value. Cloudflare already provides `cf-ipcountry`, which `geo.service.ts` reads.
4. Cache rules for `apps/web` static/ISR; keep the API host uncached. Verify WS upgrade works through the proxy (Socket.io ping keeps it under CF's ~100 s idle timeout).

---

## Host comparison (verified pricing, 2026-07) — Railway vs Fly vs Render vs Coolify vs io.net vs AWS

Researched current pricing against each platform's own pricing page for Scadium's exact footprint (always-on API + worker [+ web] + managed Postgres + Redis, single-instance, Cloudflare in front, pre-launch/low-traffic 24/7). The **must-run-24/7** requirement (the 20 Hz crash loop + persistent Socket.io can't scale-to-zero) is the gate.

| Platform | Full-stack $/mo | Fit | Verdict |
|---|---|---|---|
| **Railway** ✅ | **~$20–27** (web on Cloudflare) | 5/5 | **Winner** — never sleeps by default, first-party managed PG **and** Redis, lowest ops, cheapest managed option. |
| Coolify on a Hetzner VPS | ~$17–25 all-in | 4/5 | **Cheapest**, never sleeps — but you own DB backups/PITR/patching/uptime on a single box (risky for a ledger). Budget pick only. |
| Render | ~$61 (lean ~$30) | 5/5 | Same low-ops experience as Railway but **2–3× the price**; free tier sleeps (never use it for the API). |
| Fly.io | ~$57–61 managed (~$25 self-hosting DBs) | 4/5 | Cheap compute + great WS, but the **$38/mo Managed-Postgres floor** + no first-party Redis (Upstash) inflate it; `auto_stop` is a footgun. |
| AWS (Fargate+RDS+ElastiCache+ALB) | ~$85–115 | 3/5 | Powerful/scalable but high ops (VPC/IAM/ALB by hand) + hidden ALB/NAT/IPv4 fees. Overkill pre-launch; the single-instance design can't use its scale anyway. |
| io.net | ~$438 floor | 1/5 | **Wrong category** — a GPU/AI compute marketplace billed by GPU-hour, no CPU app tier, no managed PG/Redis. Ruled out. |

**Decision: buy Railway (Hobby plan, $5/mo minimum → real bill ~$20–27/mo).** It's the only option that is *both* a category-perfect fit and the cheapest managed host, and it's where the project + Postgres + Redis are already provisioned — the only thing missing is the paid-plan upgrade that unblocks the compute services. If absolute lowest cost outweighs ops, Coolify-on-Hetzner (~$17) is the alternative, accepting that you self-manage the databases.

**Caveat (already in the real-money checklist):** Railway's managed Postgres is a convenient single-container volume-backed instance, not HA/multi-AZ with PITR. Fine for the play-money launch; **before flipping real money, move the money-ledger Postgres to a hardened managed provider** (Neon / Supabase / RDS) — a casino ledger needs strong backups + point-in-time recovery.
