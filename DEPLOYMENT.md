# Deploying Scadium (devnet + free hosting)

This ships Scadium on **free** infrastructure: the three Anchor programs to **Solana
devnet**, and the app across Vercel + Render + Neon + Upstash. The app runs in
**play-money** mode (`REAL_MONEY_ENABLED=false`) — no gaming licence / KYC needed.

| Layer | Provider | Free tier |
|---|---|---|
| Programs (`scadium_vault`/`swap`/`lottery`) | **GitHub Actions → devnet** | ✅ (Ubuntu runner) |
| Web (`apps/web`, Next.js 15) | **Vercel** | ✅ Hobby |
| API (`apps/api`, NestJS) | **Render** web service (Docker) | ✅ (sleeps when idle) |
| Worker (`apps/worker`, BullMQ) | **Render** web service (Docker) | ✅ (see worker caveat) |
| Postgres | **Neon** | ✅ |
| Redis | **Upstash** | ✅ |

> Why GitHub Actions for the programs? Building Anchor programs requires Linux/WSL,
> and Solana's docs make WSL mandatory on Windows. The CI runner is Linux and
> already builds these programs, so we deploy from there — no local WSL needed.

### Already provisioned (this deploy)

| Resource | Status | Identifier |
|---|---|---|
| Neon Postgres | ✅ created + **migrated** | project `scadium-devnet` (org `scadium`, us-east-1) |
| Upstash Redis | ✅ created | `scadium-devnet` (us-east-1, TLS) |
| Vercel web | ✅ **live** | <https://scadium.vercel.app> (project `scadium`) |
| GH deploy workflow + `DEVNET_DEPLOYER_KEY` | ✅ ready | deployer `6y88nGbYGVzsHc49SuGfyFEcBgdsDYYeqMKiBJLsJtDT` |

`DATABASE_URL` / `REDIS_URL` are not committed — retrieve them with
`neonctl connection-string --project-id <id>` and `upstash redis get --db-id <id>`,
or from each dashboard. **Remaining:** fund the deployer + run the deploy workflow
(Part A), and host the API/worker (Part D).

---

## Part A — Deploy the programs to devnet

Program IDs are already pinned by the committed `target/deploy/*-keypair.json`
(↔ `declare_id!` ↔ `Anchor.toml`), so re-runs always hit the same addresses:

| Program | Address |
|---|---|
| `scadium_vault` | `DSQJ8FX8JGhB2nKPGVM2ptWZydskNmp8629C8HXTvrqr` |
| `scadium_swap` | `9Fog7cFRQiPfszYu1ioFdqQDwmmTd6SZpkyb8hyo13dU` |
| `scadium_lottery` | `3HHxLKiAW4JhSHaPSKpjCqCxpQgPfTd8pP6tzL8ZAVk5` |

1. **Deployer wallet** — already generated and stored as the repo secret
   `DEVNET_DEPLOYER_KEY`. Its public key is:

   ```
   6y88nGbYGVzsHc49SuGfyFEcBgdsDYYeqMKiBJLsJtDT
   ```

   > This wallet only *pays* for the deploy; it is not a program id. The private
   > key lives only in GitHub Secrets (never committed). To rotate it, generate a
   > new `id.json` and `gh secret set DEVNET_DEPLOYER_KEY < id.json`.

2. **Fund it (~8 SOL)** at <https://faucet.solana.com> (paste the pubkey above;
   the public RPC airdrop is rate-limited/dry, so use the web faucet). Three
   program deploys cost ~2 SOL each in rent.

3. **Run the deploy**: GitHub → **Actions** → **Deploy programs (devnet)** → **Run
   workflow** (cluster `devnet`). It builds, checks the balance, `anchor deploy`s
   all three, and publishes each IDL on-chain. The run summary prints the
   addresses + explorer links.

   - CLI alternative: `gh workflow run deploy-devnet.yml -f cluster=devnet`

4. **(Optional) initialize on-chain state** with the setup scripts once the API
   has a funded cosigner: `scripts/init-house.ts`, `setup-scad.ts`, `setup-pool.ts`,
   `setup-lottery.ts`.

---

## Part B — Postgres (Neon)

1. Create a project at <https://neon.tech> (free).
2. Copy the **pooled** connection string and append Prisma's schema param:
   `postgresql://USER:PASS@HOST/DB?sslmode=require&schema=public`
3. Keep it for `DATABASE_URL` (Render). Migrations run automatically on API boot
   (`docker-entrypoint.sh` → `prisma migrate deploy`).

## Part C — Redis (Upstash)

1. Create a database at <https://upstash.com> (free, Redis-compatible).
2. Copy the **TLS** URL (`rediss://default:PASS@HOST:PORT`). Keep it for `REDIS_URL`.

## Part D — API + Worker (Render)

1. <https://render.com> → **New → Blueprint** → select this repo. Render reads
   [`render.yaml`](render.yaml) and creates `scadium-api` + `scadium-worker`.
2. In each service's **Environment**, set the `sync:false` vars:
   - `DATABASE_URL` = Neon string (Part B)
   - `REDIS_URL` = Upstash URL (Part C)
   - `CORS_ORIGIN`, `SIWS_DOMAIN`, `SIWS_URI` = your Vercel origin (Part E) — set
     after the web URL exists, e.g. `https://scadium.vercel.app` /
     `scadium.vercel.app` / `https://scadium.vercel.app`.
   - `JWT_SECRET` is auto-generated for the API; **copy it into the worker** so both
     share one secret.
3. Note the API URL, e.g. `https://scadium-api.onrender.com`.

> **Worker caveat:** free web services sleep after ~15 min idle. The worker takes
> no inbound traffic, so to keep its scheduled jobs alive either ping
> `https://scadium-worker.onrender.com/` every few minutes (e.g. cron-job.org) or
> upgrade it to a paid background worker. Core gameplay does not depend on it.

## Part E — Web (Vercel) — already deployed

Project `scadium` is created, linked to this repo, and **live at
<https://scadium.vercel.app>**. There is no committed `vercel.json`; the monorepo
build lives in the Vercel **project settings**:

- Root Directory: `apps/web`
- Build Command: `cd ../.. && pnpm turbo run build --filter=@scadium/web`
  (turbo's `^build` compiles `@scadium/shared` + `@scadium/fair` first)
- Output Directory: `.next`
- Install Command: `pnpm install --frozen-lockfile`
- Env (Production): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`,
  `NEXT_PUBLIC_SOLANA_NETWORK=devnet`, `NEXT_PUBLIC_SOLANA_RPC`, `NEXT_PUBLIC_APP_NAME`.

`NEXT_PUBLIC_API_URL`/`WS_URL` currently point at the predicted Render URL
(`https://scadium-api.onrender.com`). Once the API is live (Part D), if its URL
differs, update those two env vars and redeploy: `vercel --prod` (or push to main —
the repo is git-connected). Then set the API's `CORS_ORIGIN`/`SIWS_*` to
`https://scadium.vercel.app`.

## Part F — Verify

- API health: `curl https://scadium-api.onrender.com/health`
- Programs: open the explorer links from the Part-A run summary.
- Web: open the Vercel URL, connect a devnet wallet, sign in (SIWS), play a round.

---

## Local development (Windows, no WSL needed for the app)

The app (web/api/worker) is pure Node and runs on Windows; only the *Anchor build*
needs Linux/WSL. For local full-stack you still need Postgres + Redis — either point
`DATABASE_URL`/`REDIS_URL` at the free Neon/Upstash above, or run them in Docker.

```bash
pnpm install
pnpm --filter @scadium/shared --filter @scadium/fair build   # build workspace deps first
pnpm --filter @scadium/api exec prisma migrate deploy
pnpm dev
```
