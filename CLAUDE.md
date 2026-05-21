# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Scadium — non-custodial, provably-fair Solana casino (Crash, Coinflip, Blackjack) modeled after solpump.io. Currently runs off-chain on a play-money balance (`User.playBalanceLamports`, seeded at 10 SOL); on-chain settlement via Anchor programs is planned for Phase 4+ (see `programs/` and the roadmap in `~/.claude/plans/misty-cooking-stearns.md`).

## Stack & layout

pnpm + Turborepo monorepo. Node ≥ 20, pnpm ≥ 10.

- `apps/web` — Next.js 15 (App Router, React 19, Tailwind, Solana wallet-adapter, Socket.io client, Zustand, TanStack Query)
- `apps/api` — NestJS 10 (REST under `/api/v1`, Socket.io gateways, Prisma + Postgres, JWT auth, Swagger at `/docs`)
- `apps/api/prisma` — single Postgres schema, source of truth for the DB
- `apps/worker` — BullMQ worker (airdrops, leaderboards) — listed in README but not yet present in `apps/`
- `packages/shared` — TS types, zod schemas, and game constants (`COINFLIP`, `CRASH`, `BLACKJACK`, `AFFILIATE`, …)
- `packages/fair` — provably-fair engine (HMAC-SHA256 over `${clientSeed}:${nonce}`, keyed by serverSeed)
- `packages/ui` — shared component primitives
- `programs/` — Anchor (Rust) Solana programs (Phase 4+; currently empty/stubbed)
- `infra/docker-compose.yml` — Postgres 16 + Redis 7 for local dev

TS path aliases (`tsconfig.base.json`) map `@scadium/{shared,fair,ui}` → each package's `src/`. The web app additionally lists them under `transpilePackages` in `next.config.mjs`.

## Common commands

```bash
pnpm install                             # install (also runs `prisma generate` postinstall in apps/api)
docker compose -f infra/docker-compose.yml up -d   # Postgres + Redis
pnpm dev                                 # turbo: all dev servers in parallel
pnpm build | pnpm lint | pnpm typecheck | pnpm test | pnpm format
```

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

CI (`.github/workflows/ci.yml`) runs: `prisma migrate deploy` → build `@scadium/shared` and `@scadium/fair` → `@scadium/fair` tests → `turbo run typecheck` → build web → `tsc` build api. Mirror that order locally when debugging CI failures.

## Architecture — things that span multiple files

**Provably-fair primitive.** Every game result is derived in one place: `packages/fair/src/hash.ts:hmacSha256(serverSeed, `${clientSeed}:${nonce}`)`. The API commits `sha256(serverSeed)` on the `Seed` row before the round, writes the result, then sets `revealedAt` and exposes `serverSeed` so the client can reproduce via the same fair package (also shipped to the browser through `transpilePackages`). When changing result derivation, edit `packages/fair/src/{crash,coinflip,blackjack}.ts` and update the vitest suites — the formulas are the spec.

**Crash is a singleton background loop, not request-driven.** `apps/api/src/games/crash/crash.engine.ts` (`@Injectable() implements OnModuleInit`) holds the *only* in-memory state for the live round: betting window → 20Hz tick loop → bust → settle → next round. `CrashService` and `CrashController` are thin wrappers around the engine; `CrashGateway` (Socket.io namespace `/crash`) broadcasts ticks. `placeBet` rejects unless `phase === 'waiting'`; `cashOut` rejects unless `phase === 'running'`. The bust point is committed before betting opens — never mutate `current.bustPoint` mid-round.

**Coinflip is request-driven and transactional.** `apps/api/src/games/coinflip/coinflip.service.ts` runs each create/join/cancel inside `prisma.$transaction`. A fresh `Seed` is committed per flip (nonce is always 0). Balance debits happen on create (creator) and join (joiner), and the winner is credited 1.9× the stake (5% house edge) — the pot is 2× stake, so house take = `pot - 1.9 × stake`. Two `Bet` rows are written per resolved flip (one per side).

**Blackjack** lives in `apps/api/src/games/blackjack/`. Tables have infinite-deck model, `DEALER_HITS_SOFT_17 = true`, no surrender. State is persisted as JSON in `BlackjackRound.stateJson`.

**Ledger model.** `User.playBalanceLamports` is the live balance (BigInt). The `Bet` table is the unified, game-agnostic history (`gameType`, `amountLamports`, `payoutLamports`, `multiplier`, `status`, `resultJson`). Per-game tables (`CrashBet`, `CoinflipGame`, `BlackjackRound`) hold game-specific detail. Settling a round always writes both: update `User` aggregates (`totalWagered`, `totalWon`, `totalLost`, `gamesPlayed`, `biggestWin`), insert per-game row, insert `Bet` row. Use `BigInt` end-to-end — lamports never fit `number`.

**Auth = SIWS (Sign-In With Solana).** `apps/api/src/auth/siws.service.ts` issues a nonce, builds a canonical multi-line message including `Issued At`, and verifies the wallet's ed25519 signature via `tweetnacl`. The exact message string is reused on verify (re-derived from the stored `issuedAt`); the frontend in `apps/web/src/hooks/use-siws-sign-in.ts` must display the identical string before signing. Nonce store is currently in-memory (move to Redis for prod) with 5-minute TTL. After verify, the auth controller issues a JWT (`@nestjs/jwt`).

**Realtime.** Per-feature Socket.io namespaces (`/crash`, `/coinflip`, `/chat`, …) on the API side. Browser side: `apps/web/src/providers/socket-provider.tsx` lazily creates one connection per namespace and reuses it across components — call `useSocket('/crash')` from a component.

**HTTP client.** `apps/web/src/lib/api-client.ts:api()` is the single fetch wrapper. It prefixes `${NEXT_PUBLIC_API_URL}/api/v1`, attaches the JWT from the auth store, and throws `ApiError`. Don't bypass it.

**Global pipes/prefix on the API.** `main.ts` enables `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` and `setGlobalPrefix('api/v1', { exclude: ['health'] })`. All controller DTOs assume class-validator and that unknown fields are stripped.

## Conventions that aren't obvious from `tsconfig`

- `noUncheckedIndexedAccess` is on globally — `arr[i]` is `T | undefined`. Narrow before use.
- Prettier: single quotes, semis, trailing commas, 100-col, LF.
- Money is `BigInt` (lamports). Multipliers are JS `number` but persisted with `Float?` precision in Prisma — sufficient for ≤ 1e6× multipliers.
- Game tuning lives in `packages/shared/src/constants.ts`. Don't hard-code limits or multipliers in services or UI — import from `@scadium/shared`.
- CI uses `pnpm install --frozen-lockfile`; commit `pnpm-lock.yaml` changes whenever `package.json` deps move.
