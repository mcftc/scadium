# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Scadium — non-custodial, provably-fair Solana casino modeled after solpump.io, now with **12 games** (`apps/api/src/games/*`): Crash, Coinflip, Blackjack, Jackpot, Lottery, Dice, Limbo, HiLo, Mines, Plinko, Tower, Wheel. **It defaults to a play-money balance** (`User.playBalanceLamports`, seeded at 10 SOL): every casino game debits/credits Postgres, not the chain. Real money is a **fail-closed boot toggle** — `main.ts` runs `assertRealMoneyReady` and refuses to start with `REAL_MONEY_ENABLED` unless licence + KYC + geoblocking are configured (see `apps/api/src/compliance/`). On-chain Phases A–F shipped the Anchor programs (`scadium_vault`/`scadium_swap`/`scadium_lottery`), a `$SCAD` rewards economy, a SCAD/SOL CPMM pool + buy-and-burn, and on-chain lottery draws; the IDL + program keypairs are now **committed under `target/`** and CI runs `anchor build` + localnet integration + an IDL-drift gate. The chain layer is still **off-chain-first** — balances live in Postgres and the programs aren't yet mainnet-live for real money — but it is no longer unbuilt. Making it real money is the roadmap.

**Read `ANALYSIS.md` (repo root) first** — it is the authoritative gap analysis: per-subsystem maturity, a risk register (5 critical / 10 high), a feature gap matrix, and the phased roadmap **G→M** with a real-money gating checklist. The work is tracked as GitHub issues/milestones (one milestone per phase G–M) on `mcftc/scadium`. There is **no** `~/.claude/plans/*` file — that earlier reference is stale.

**Working the roadmap (multi-agent dev pipeline).** This repo ships a committed Claude Code pipeline in `.claude/` (see `.claude/README.md`). Use **`/plan <what you need>`** to decompose a new need into GitHub issues (epic + tasks, acceptance criteria, E2E requirements, milestone, labels) — just like the roadmap. Then run **`/scadium-next`** to take the next open issue (Phase G→M, priority P0→P3) — or **`/dev-task <issue#>`** for a specific one — through developer → tester → reviewer → PR → CI-gate → squash-merge. Money/fairness/security findings are blocking and **no task merges on a red gate or without its mandated tests**. "Continue where we left off" = open the repo and run `/scadium-next`. **Always verify an issue's audit premise against the real code before implementing** (the audit has been wrong — e.g. #3 was already guarded at the service layer).

## Stack & layout

pnpm + Turborepo monorepo. Node ≥ 20, pnpm ≥ 10.

- `apps/web` — Next.js 15 (App Router, React 19, Tailwind, Solana wallet-adapter, Socket.io client, Zustand, TanStack Query)
- `apps/api` — NestJS 11 + Express 5 (REST under `/api/v1`, Socket.io gateways, Prisma + Postgres, SIWS+JWT auth, Swagger at `/docs` — gated off in prod unless `DOCS_ENABLED`). Also: pino structured logging, Sentry, Prometheus `/metrics`, and `@nestjs/throttler` per-IP rate-limiting.
- `apps/api/prisma` — single Postgres schema, source of truth for the DB
- `apps/worker` — BullMQ worker process (Phase H, **shipped**): boots the API's `WorkerModule` headless and runs **9 Redis-backed queues** (`airdrop`, `burn`, `leaderboard`, `reconcile`, `rewardClaims`, `lotteryPayouts`, `distribution`, `blockMining`, `vaultAccrual`) on repeatable schedulers. Each job is idempotent + Redis-locked, so running ≥2 replicas is safe. The engines/services live in `apps/api` (`src/worker/worker.module.ts`); the worker just hosts them out-of-process.
- `packages/shared` — TS types, zod schemas, and game constants (`COINFLIP`, `CRASH`, `BLACKJACK`, `AFFILIATE`, …)
- `packages/fair` — provably-fair engine (HMAC-SHA256 over `${clientSeed}:${nonce}`, keyed by serverSeed)
- `packages/ui` — shared component primitives
- `programs/` — Anchor (Rust) Solana programs: `scadium_vault`, `scadium_swap`, `scadium_lottery`. Built + tested in CI (`anchor build`, `cargo test/clippy/audit`, localnet integration); the generated IDL (`target/idl/*.json`) and program keypairs (`target/deploy/*-keypair.json`) are **committed**, and an IDL-drift gate fails CI if a program change isn't accompanied by its regenerated IDL. Not yet deployed to mainnet.
- `infra/docker-compose.yml` — Postgres 16 + Redis 7 for local dev. Redis is now **core**: BullMQ queues (worker), distributed locks, and the Socket.io Redis adapter for multi-replica broadcast. `infra/helm/scadium` is the production Helm chart (CI lints + renders it).

TS path aliases (`tsconfig.base.json`) map `@scadium/{shared,fair,ui}` → each package's `src/`. The web app additionally lists them under `transpilePackages` in `next.config.mjs`.

## Common commands

```bash
pnpm install                             # install (also runs `prisma generate` postinstall in apps/api)
pnpm --filter @scadium/shared --filter @scadium/fair build   # ⚠️ build workspace pkgs FIRST (see note below)
docker compose -f infra/docker-compose.yml up -d   # Postgres + Redis
pnpm --filter @scadium/api exec prisma migrate deploy        # apply migrations
pnpm --filter @scadium/api prisma:seed                       # optional: demo users + chat
pnpm dev                                 # turbo: all dev servers in parallel
pnpm build | pnpm lint | pnpm typecheck | pnpm test | pnpm format
```

> **Cold-start gotcha:** the API imports `@scadium/{shared,fair}` which resolve to each package's `dist/` at runtime, but `turbo.json`'s `dev` task has **no** `dependsOn: ["^build"]`, so a fresh-clone `pnpm dev` (or `pnpm --filter @scadium/api dev`) fails with `Cannot find module '@scadium/shared'` until those packages are built once. Build them first (command above), or fix it properly per Phase H (add the `^build` dep / a `predev` step). Also note Prisma CLI reads `DATABASE_URL` from `apps/api/.env` (absent) — the value lives in the **root** `.env`; export it inline or rely on the API's `ConfigModule` (`envFilePath: ['../../.env', '.env']`) at runtime.

Web → http://localhost:3000 · API → http://localhost:4000 · Swagger → http://localhost:4000/docs

Filter to a single workspace:

```bash
pnpm --filter @scadium/web dev
pnpm --filter @scadium/api dev                       # nest start --watch
pnpm --filter @scadium/api prisma:migrate            # prisma migrate dev (writes new migration)
pnpm --filter @scadium/api exec prisma migrate deploy # CI-style apply (no schema diff)
pnpm --filter @scadium/api prisma:studio
pnpm --filter @scadium/fair test                     # vitest run
pnpm --filter @scadium/fair test -- crash.test       # single test file
```

CI (`.github/workflows/ci.yml`) has multiple jobs: **build** (dep audit, bootstrap guard, `prisma migrate deploy`, build `@scadium/{shared,fair}`, fair tests incl. Node⇄browser parity, API unit tests, typecheck, build web/api/worker); **api-integration** (Postgres + Redis services, `test:integration`); **anchor-tests** (`cargo test/clippy/audit`, `anchor build`, IDL-drift gate, localnet `anchor test`); **secret-scan** (gitleaks); **container-scan** (Trivy); **audit-status** (real-money cutover gate); **helm-chart** (lint + template); **web-e2e** (Playwright). Mirror the relevant job's step order locally when debugging.

## Architecture — things that span multiple files

**Provably-fair primitive.** Every game result is derived in one place: `packages/fair/src/hash.ts:hmacSha256(serverSeed, `${clientSeed}:${nonce}`)`. The API commits `sha256(serverSeed)` on the `Seed` row before the round, writes the result, then sets `revealedAt` and exposes `serverSeed` so the client can reproduce via the same fair package (also shipped to the browser through `transpilePackages`). When changing result derivation, edit `packages/fair/src/{crash,coinflip,blackjack}.ts` and update the vitest suites — the formulas are the spec.

**Crash is a singleton background loop, not request-driven.** `apps/api/src/games/crash/crash.engine.ts` (`@Injectable() implements OnModuleInit`) holds the *only* in-memory state for the live round: betting window → 20Hz tick loop → bust → settle → next round. `CrashService` and `CrashController` are thin wrappers around the engine; `CrashGateway` (Socket.io namespace `/crash`) broadcasts ticks. `placeBet` rejects unless `phase === 'waiting'`; `cashOut` rejects unless `phase === 'running'`. The bust point is committed before betting opens — never mutate `current.bustPoint` mid-round.

**Coinflip is request-driven and transactional.** `apps/api/src/games/coinflip/coinflip.service.ts` runs each create/join/cancel inside `prisma.$transaction`. A fresh `Seed` is committed per flip (nonce is always 0). Balance debits happen on create (creator) and join (joiner), and the winner is credited 1.9× the stake (5% house edge) — the pot is 2× stake, so house take = `pot - 1.9 × stake`. Two `Bet` rows are written per resolved flip (one per side).

**Blackjack** lives in `apps/api/src/games/blackjack/`. Tables have infinite-deck model, `DEALER_HITS_SOFT_17 = true`, no surrender. State is persisted as JSON in `BlackjackRound.stateJson`.

**Ledger model.** `User.playBalanceLamports` is the live balance (BigInt). The `Bet` table is the unified, game-agnostic history (`gameType`, `amountLamports`, `payoutLamports`, `multiplier`, `status`, `resultJson`). Per-game tables (`CrashBet`, `CoinflipGame`, `BlackjackRound`) hold game-specific detail. Settling a round always writes both: update `User` aggregates (`totalWagered`, `totalWon`, `totalLost`, `gamesPlayed`, `biggestWin`), insert per-game row, insert `Bet` row. Use `BigInt` end-to-end — lamports never fit `number`.

**SCAD Engine (staking + GGR dividends).** bc.game's engine, adapted: earned `$SCAD` is staked (`User.scadiumStaked`, time-locked via `stakeLockedUntil`) by `apps/api/src/staking/`, and an hourly `apps/api/src/engine/distribution.service.ts` round pays stakers a pro-rata share of casino NGR — `ENGINE.DIVIDEND_NGR_BPS` (6% = 600 bps) — in **USDS** (USD-pegged dividend stablecoin, `User.usdsBalance`, 6 decimals), claimed on-chain via `claim_dividend` (vault program) through the same reservation-based `RewardClaim(kind='dividend')` lifecycle as $SCAD claims. Buy-and-burn now takes a parallel `ENGINE.BUYBACK_NGR_BPS` (6% = 600 bps, was 10% → originally 20%). The distribution job runs in `@scadium/worker` (queue `distribution`, hourly, Redis-locked), idempotent per `DistributionRound.period`. All money tuning lives in `ENGINE`/`USDS` in `packages/shared/src/constants.ts`; balances move only through `applyBalanceDelta` (currencies `scad`/`scad_staked`/`usds`). **Engine coverage contract:** a game is only in the engine if its settlement writes a `Bet` row AND calls `ProofOfWagerService.accrue()`; the guard `src/proof-of-wager/coverage.spec.ts` maps every `GameType` to its settlement file and fails if a new game skips `accrue` — wire both when adding a game.

**SCAD Vault (term staking).** The LOCKED tier that complements the (now liquid) Engine: a user locks `$SCAD` into a fixed-term pool (`VaultPool`, one per `(asset, termDays)` — 30/90/180/365) as a `VaultPosition` (a contract with its own `maturesAt`). Accounting is share/index based (ERC-4626-style): `VaultPool.indexRay` is the share price; a deposit mints shares at the current index (index unchanged), and yield + early-exit penalties RAISE the index so positions appreciate pro-rata in O(1). `apps/api/src/vault/vault.service.ts` does deposit/withdraw (early withdrawal before `maturesAt` keeps `VAULT.EARLY_EXIT_PENALTY_BPS` in the pool, lifting the index for holders); `apps/api/src/vault/vault-accrual.service.ts` is the hourly worker round (queue `vault-accrual`) that takes `VAULT.YIELD_NGR_BPS` of NGR, converts lamports→$SCAD (`lamportsToScadBase`), and splits it across pools by `weightBps × totalShares`. Balances move only through `applyBalanceDelta` (currencies `scad` ↔ `scad_vault`; `User.scadiumVault` is the principal aggregate). **NGR-budget invariant:** Engine dividend (6%) + buy-and-burn (6%) + Vault yield (8%) must stay ≤ 20% — `ngrRedistributionBps()` + the vault-math test guard it. The math lives purely in `packages/shared/src/constants.ts` (`VAULT`, `sharesForDeposit`/`assetsForShares`/`applyAccrual`/`earlyExitPenalty`), so the Rust program (`programs/scadium_vault` — `init_vault_pool`/`vault_deposit`/`vault_withdraw`/`vault_accrue`) mirrors it bit-for-bit. The chain layer is the same off-chain-first hybrid as everywhere else: `ChainService.vaultAccrue`/`readVaultPoolOnChain` are cosigner-gated and no-op until deploy (deposit/withdraw are USER-signed client-wallet flows); `ReconciliationService.vaultLedgerDrift()` asserts the off-chain invariants (Σ position shares == pool.totalShares; Σ principal == `User.scadiumVault`) and `vaultDrift()` flags off-chain↔on-chain divergence once live. See `docs/runbooks/vault-onchain.md`.

**Compliance & real-money gate.** `apps/api/src/{compliance,kyc,responsible-gambling}/` guard the real-money path. `assertRealMoneyReady` (`compliance/real-money-gate.ts`) fails the boot **closed** unless licence + KYC + geoblocking (IP-salt / proxy-secret) + VPN detection are configured; geoblocking is always enforced. Toggled by `REAL_MONEY_ENABLED`.

**Reconciliation & solvency.** `apps/api/src/reconciliation/` runs on the worker's `reconcile` cadence: `reconcileAll` + `houseSolvency` + `scadLedgerDrift`/`stakeLedgerDrift`/`usdsSolvency` (ledger invariants) + `sweepLotteryPrizes`. It is the safety net asserting off-chain ledgers balance and the house vault stays above its rent floor.

**SCAD Engine v2 — block mining (Proof-of-Play).** Parallel to the dividend round, `apps/api/src/engine/` mints an hourly `EngineBlock` and splits it across players by wager (`EngineBlockShare`), idempotent per hour, driven from the worker's `blockMining` queue.

**Auth = SIWS (Sign-In With Solana).** `apps/api/src/auth/siws.service.ts` issues a nonce, builds a canonical multi-line message including `Issued At`, and verifies the wallet's ed25519 signature via `tweetnacl`. The exact message string is reused on verify (re-derived from the stored `issuedAt`); the frontend in `apps/web/src/hooks/use-siws-sign-in.ts` must display the identical string before signing. Nonce store is currently in-memory (move to Redis for prod) with 5-minute TTL. After verify, the auth controller issues a JWT (`@nestjs/jwt`).

**Realtime.** Per-feature Socket.io namespaces (`/crash`, `/coinflip`, `/chat`, …) on the API side. Browser side: `apps/web/src/providers/socket-provider.tsx` lazily creates one connection per namespace and reuses it across components — call `useSocket('/crash')` from a component.

**HTTP client.** `apps/web/src/lib/api-client.ts:api()` is the single fetch wrapper. It prefixes `${NEXT_PUBLIC_API_URL}/api/v1`, attaches the JWT from the auth store, and throws `ApiError`. Don't bypass it.

**Global pipes/prefix on the API.** `main.ts` enables `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` and `setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready', 'metrics'] })` (probes + the Prometheus scrape stay unprefixed). All controller DTOs assume class-validator and that unknown fields are stripped. Boot order in `main.ts`: `initSentry()` → pino logger → `assertRealMoneyReady` compliance gate → `trust proxy` (per-IP throttling) → Redis Socket.io adapter (when `REDIS_URL` set, for multi-replica) → pipes → CORS → prefix → gated Swagger.

## Conventions that aren't obvious from `tsconfig`

- `noUncheckedIndexedAccess` is on globally — `arr[i]` is `T | undefined`. Narrow before use.
- Prettier: single quotes, semis, trailing commas, 100-col, LF.
- Money is `BigInt` (lamports). Multipliers are JS `number` but persisted with `Float?` precision in Prisma — sufficient for ≤ 1e6× multipliers.
- Game tuning lives in `packages/shared/src/constants.ts`. Don't hard-code limits or multipliers in services or UI — import from `@scadium/shared`.
- CI uses `pnpm install --frozen-lockfile`; commit `pnpm-lock.yaml` changes whenever `package.json` deps move.
