# Changelog

All notable changes to Scadium. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Work is tracked in `BACKLOG.md`; production-readiness findings in `docs/audit/phase-0-ground-truth.md`.

## [Unreleased]

### Fixed
- **Responsible-gambling limit bypass (H20):** coinflip `join` now passes the flip's stake and lottery `buyTicket` passes the ticket's lamport cost to `assertCanWager` (both previously passed `0n`, which short-circuits the daily wager/loss-limit check). A self-limited player can no longer bypass their limit by joining flips or buying tickets. `coinflip.service.ts`, `lottery.service.ts`. Tests: `coinflip.service.spec.ts`, `lottery-rg.spec.ts`.
- **Crash auto-cashout below bust (H3):** an auto-cashout whose target is below the committed bust point is now paid at that target regardless of 20 Hz tick granularity (previously a tick that jumped past bust made `cashOut` re-derive the live multiplier, see it >= bust, and throw — voiding the win). Payout also rounds instead of flooring (`Math.floor(m*100)` underpaid 0.01×). `apps/api/src/games/crash/crash.engine.ts`. Test: `apps/api/test/crash-autocashout-target.e2e-spec.ts`.
- **Seed-rotation fairness (C3):** `SeedManagerService.rotateServerSeed` now refuses (Serializable + active-round check) while any stateful round (mines/tower/hilo) is in progress, so a player can no longer reveal the active server seed mid-round to reproduce the committed layout and win deterministically. `apps/api/src/fairness/seed-manager.service.ts`. Test: `apps/api/test/seed-rotation.e2e-spec.ts`.
- **Coinflip cancel/join TOCTOU (H2):** `cancel()` now claims the flip with a guarded compare-and-swap (`updateMany where status='open'`) before refunding, mirroring `join()`. A cancel racing a concurrent join can no longer both refund the creator's stake and let the flip resolve (money duplication). `apps/api/src/games/coinflip/coinflip.service.ts`. Regression: `coinflip.service.spec.ts` cancel-CAS unit guard.
- **Blackjack money-integrity (C1/C2):** a rebet placed during the 5-second "settled" result pause no longer refunds the already-settled stake (money creation), and other seats' prior-round bets no longer ride the next round without a fresh debit. `apps/api/src/games/blackjack/blackjack.engine.ts` now clears every seat's bet when a new bet opens a round from the `settled` phase. Regression test: `apps/api/test/blackjack-rebet-settled.e2e-spec.ts` (red→green; existing blackjack suites still pass).

### Added
- Phase 0 ground-truth audit (`docs/audit/phase-0-ground-truth.md`) — independent re-baseline of origin/main (#365): 15-subsystem adversarial audit + live money-path probing. 5 critical / 32 high confirmed, 0 refuted.
- Deployment & stack decision doc (`docs/deployment-architecture.md`) — recommends Cloudflare edge + Railway (compute + data), keeping NestJS/Prisma/TS (no .NET rewrite).
- `BACKLOG.md` + this `CHANGELOG.md` as the working process (replacing mandatory GitHub issues).
- Cloudflare Claude Code plugin + skills + MCP servers installed for the migration.

### Notes
- Local `main` was re-synced from PR #59 → origin/main #365 (was 183 commits behind); all subsequent work is on #365.
