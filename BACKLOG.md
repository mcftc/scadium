# Scadium — Backlog

Source of truth for planned work (replaces GitHub issues per owner decision, 2026-07-16). Derived from the Phase 0 audit (`docs/audit/phase-0-ground-truth.md`). Ordered by tier; within a tier, by severity. Check items off as they ship and record them in `CHANGELOG.md`.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **Cxx/Hxx** map to audit IDs.

---

## Tier 1 — Live play-money integrity (fix first; these are exploitable today)

- [x] **C1 · Blackjack rebet during settle-pause prints money.** ✅ Fixed: a bet arriving in phase `settled` clears all seats' prior-round bets before landing, so `previousTotalLamports` is 0 (no bogus refund). `blackjack.engine.ts` placeBet. Test: `test/blackjack-rebet-settled.e2e-spec.ts` (red→green).
- [x] **C2 · Blackjack stale seats ride the next round free.** ✅ Fixed by the same clear-on-settled change: other seats' stale bets are nulled, so none rides the new round without a fresh debit. Covered by the same test.
- [x] **C3 · Seed rotation leaks the active seed mid-round → deterministic mines/tower/hilo wins.** ✅ Fixed: `rotateServerSeed` now runs Serializable and refuses (409) while any `active` InstantRound exists for the user, so the seed a round's layout derives from can't be revealed mid-round. `seed-manager.service.ts`. Test: `seed-rotation.e2e-spec.ts` (red→green).
- [x] **H2 · Coinflip `cancel()` TOCTOU duplicates money.** ✅ Fixed: `cancel()` now flips the row via a guarded CAS (`updateMany where status='open'`) and only refunds when it claims the row, mirroring `join()` — a cancel racing a join can no longer both refund and resolve. `coinflip.service.ts`. Test: `coinflip.service.spec.ts` cancel-CAS unit guard (red→green).
- [x] **H3 · Crash auto-cashout can pay ZERO below the bust point.** ✅ Fixed: auto-cashouts settle at the player's committed target (validated `< bustPoint`), bypassing the live-multiplier bust race, and payout rounds (`Math.round`) instead of flooring. `crash.engine.ts` cashOut/runAutoCashouts. Test: `crash-autocashout-target.e2e-spec.ts` (red→green).
- [x] **H1 · Blackjack restart during betting confiscates stakes.** ✅ Fixed: accepted betting-window bets are persisted to the round's stateJson as they are placed/cleared (`persistBettingStakes`), so boot recovery refunds them. `blackjack.engine.ts` (placeBet/clearBet/leaveSeat now async). Test: `blackjack-betting-recovery.e2e-spec.ts` (red→green).
- [x] **H11 · Hourly settle jobs run mid-hour on partial data.** ✅ Fixed: airdrop/dividends/block-mining/vault-accrual now target `lastCompletedHourPeriod(now)` (the last FULLY-elapsed hour) instead of the in-progress one, so they settle whole hours and the airdrop stops rejecting tips for the rest of the hour. `queue.constants.ts` + 5 settle sites. Test: `queue.constants.spec.ts` + updated hourly e2e suites.
- [x] **H20 · RG limits bypassed on coinflip/lottery.** ✅ Fixed: `coinflip.join` passes the flip's stake and `lottery.buyTicket` passes the ticket's lamport cost to `rg.assertCanWager`, so a self-limited player's joins/tickets count against their daily wager/loss limit. Tests: `coinflip.service.spec.ts` + `lottery-rg.spec.ts` (red→green).
- [x] **H18 · Affiliate commission has no payout path.** ✅ Fixed (claim path): `POST /affiliates/claim` credits accrued commission to the play balance via a Serializable delta-claim (`commissionClaimedLamports` marker, migration `20260716120000`); stats now expose `claimableCommissionLamports`. Test: `affiliate-claim.e2e-spec.ts`. NOTE follow-up: commission still accrues only from crash/coinflip — wiring the other games to `creditReferral` is a separate enhancement (tracked in Tier 4/enhancements).

## Tier 2 — Real-money cutover blockers (before flipping `REAL_MONEY_ENABLED`)

- [ ] **C4 · Reward/dividend claim double-pay on missed confirmation.** Chain send swallows errors to null; failed-path restores the reserve while tokens already landed. Add an on-chain existence/signature probe before restore. `rewards.service.ts:384`, `chain.service.ts:965`.
- [ ] **H13 · Reward claim `period = Date.now()` defeats idempotency.** Use a fixed bucket (per-day/week) so `@@unique([userId,kind,period])` + the ClaimRecord PDA actually bind. `rewards.service.ts:56,147`.
- [x] **H5a · `verifyVaultTransfer` trusts forged events.** ✅ Fixed: new `programScopedEventPayloads` tracks the Solana invoke stack so only `Program data:` lines emitted while OUR vault program is the active frame are trusted; a look-alike program's forged event (incl. via CPI) is rejected. `vault-events.ts` + `chain.service.ts`. Test: `vault-events.spec.ts`.
- [x] **H5 · `verifyTicketTx` accepts forged `TicketBought` events** → ✅ same fix: ticket parse now scoped to the configured lottery program via `programScopedEventPayloads`. `chain.service.ts`.
- [ ] **H5b · On-chain settlement bridge unwired.** `settleBet` has zero callers → net play never sweeps between user/house vaults (loser self-withdraws deposit; winner unfunded). Wire it + schedule the `fundedDrift/chainDrift/vaultDrift` monitors. `chain.service.ts:291`, `vault-bridge.service.ts:97`.
- [ ] **H5a · `verifyVaultTransfer` trusts forged events.** Assert the confirmed tx invoked `VAULT_PROGRAM_ID` + verify lamport delta. `chain.service.ts:227`.
- [x] **H4 · Lottery never pays winners in default (chain-disabled) mode.** ✅ Fixed: the settle now credits each winning ticket's `payoutLamports` to the winner's play balance via `applyBalanceDelta` when the chain is disabled (on-chain mode still pays $SCAD on-chain, so no double-pay). `lottery.engine.ts`. Test: `lottery-playmoney-payout.e2e-spec.ts` (red→green).
- [ ] **H6 · `/lottery/faucet` drains the cosigner.** 100 $SCAD to any caller, no devnet/admin/limit guard. `lottery.service.ts:214`.
- [ ] **H7 · On-chain daily draw can never reveal** (`target_slot` expires before reveal → synthetic fallback, `pay_prize` fails forever). Re-pin the slot near reveal. `lottery.engine.ts:401`.
- [ ] **H8 · Restart settles the open lottery draw early** (`recoverStrandedDraws` has no `drawAt` filter). `lottery.engine.ts:191`.
- [ ] **H9 · Real-money gate not coupled to mainnet-custody config.** A non-prod `NODE_ENV` + mainnet + program id + file cosigner enables real deposits with KYC failing open. `real-money-gate.ts:23`.
- [ ] **H10 · Program deploy keypairs committed to git** → IDs burned. Regenerate fresh, uncommitted keypairs before any deploy. `target/deploy/*-keypair.json`.
- [ ] **Swap module (unverified) ·** forged `Swapped` events in `recentTrades`; `runBuyAndBurn` not crash-idempotent; burn burns the entire cosigner ATA. Audit + fix before enabling the pool. `swap.service.ts`.
- [ ] **Reward reserve/restore writes no ledger row** → false solvency drift once chain is on. Route through the ledger (or add a reserved-aware drift rule).
- [ ] **Legal ·** KYC/geo/age/licence enforcement exercised end-to-end in the money path (plumbing exists); completed third-party program audit + pentest before real funds.

## Tier 3 — Product copy / compliance (cheap; before any public launch)

- [x] **H17 · False capability/audit/RTP claims.** ✅ Fixed: "Audited: Yes"→"Pending"; six RTP figures corrected to 95% (Limbo/Mines/Tower/HiLo/Wheel/Plinko; Dice 99%/Blackjack 99.5% are correct and kept); dropped "on-chain VRF", the "On-Chain Games" tagline, "every fill is a real transaction", "on-chain AMM"; `metadataBase` + affiliate URL → scadium.com.

## Tier 4 — Ops / platform (Cloudflare) ✅ migrated 2026-09-21

Railway is gone (project soft-deleted, `deletedAt: 2026-09-22`). The stack runs on
Cloudflare: `apps/web` on Workers via OpenNext, `apps/api` + `apps/worker` as one
Cloudflare Container, Cron Triggers driving the 9 economy jobs, Postgres on Neon free,
Redis inside the container. Design: `docs/superpowers/specs/2026-09-20-cloudflare-migration-design.md`.
Operations: `docs/runbooks/cloudflare.md`.

- [x] Move compute off Railway onto Cloudflare Containers (existing Dockerfile, money core untouched).
- [x] `apps/web` → Workers via `@opennextjs/cloudflare`; routes `scadium.com/*`, `www`, `api.scadium.com/*`.
- [x] Cron Triggers → one generic `POST /api/v1/internal/jobs`; shared job registry so the worker and cron never duplicate money-moving logic.
- [x] Drop the planned Upstash dependency — Redis runs in-container (ephemeral coordination only).
- [x] Cut over DNS; verified zero Railway headers, live WebSocket, SIGKILL restart recovery.
- [x] Delete the Railway project.

### Remaining platform work

- [ ] **Avatars → R2 (bucket `scadium-avatars` created, NOT wired).** Avatars are still base64 data-URLs inside Postgres (`users/dto/update-profile.dto.ts:16`), which eats Neon free's **0.5 GB, and exceeding it blocks writes** — an outage for the ledger, not a degradation. Blocker: a container is a plain Linux process and **cannot use Worker bindings**, so it needs S3-compatible R2 credentials. `wrangler` has no command to mint them — create an R2 API token in the dashboard (R2 → Manage API tokens → Object Read & Write, bucket `scadium-avatars`), then set `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` as Worker secrets and implement `storage/r2.service.ts`. Keep the existing size cap and SVG rejection — that is an XSS guard.
- [ ] **Edge hardening.** Workers `ratelimit` binding on `/api/v1/auth/*` (replaces the Redis throttler), a WAF rate-limiting rule, Bot Fight Mode, Turnstile on signup, SSL Full (strict) + HSTS, a Transform Rule injecting `x-geo-proxy-secret` (and stripping client-supplied values), and blocking `/metrics` at the edge.
- [ ] **Cold start is inherent at this budget.** Boot is ~22-36s (NestJS graph + `prisma migrate deploy`) against the container library's 20s port timeout, so the first request after an idle period fails and the page self-heals ~40s later. Removing it means never sleeping, which costs on BOTH sides: ~$7/mo container **and** a paid Neon plan, because always-on keeps Neon's compute active far past the free 100 CU-hours. Decide at launch, not before. Measurements in spec §8.6.
- [ ] **`SLEEP_AFTER` is a budget dial, not just a latency one.** At the hourly cron: 10m ≈ 134 container-hours/month (over Neon free's 100 CU-hour cap); 5m ≈ 73 (current setting). Revisit together with the Neon plan.
- [ ] **Phase 2 — shrink to Cloudflare-only.** BullMQ → Cloudflare Queues, SIWS nonces → Durable Object, Prometheus → Analytics Engine, then delete Redis entirely. Postgres stays on Neon because Cloudflare has no equivalent at any price under ~$10/mo.

## Tier 5 — Hygiene (low)

- [ ] **Pre-existing (not this branch): `apps/web/src/components/chain/chain-copy.test.tsx` has 7 failing assertions**, latent because **CI never runs web vitest** (only Playwright `test:e2e`, `ci.yml:327`) — `pnpm test` (turbo) surfaces them. Two causes: (a) 4 AboutPage cases throw `ReferenceError: IntersectionObserver is not defined` (jsdom polyfill gap — `game-stage.tsx` uses it); a `vitest.setup` polyfill fixes those cleanly. (b) 3 cases (Footer "instant on-chain settlement", GamesGrid "every bet is on-chain", HeroSection "your SOL stays in your control") assert on-chain phrases that exist in **neither origin/main nor HEAD** — the #42 copy-gating test is out of sync with the actual copy. Fixing (b) is a product-copy decision (add the gated copy back vs update the test); it interacts with H17's honesty direction. Also worth wiring web vitest into CI so this can't rot again.

- [~] Avatar `avatarUrl`: ✅ tightened validation — only base64 raster (png/jpeg/webp/gif) data URLs, http(s), or empty; SVG/script payloads rejected (stored-XSS); 120 KB cap kept. Test: `update-profile-avatar.spec.ts`. Move-to-bucket deferred to the Railway migration.
- [x] List endpoints: ✅ shared `parseLimit()` helper (`common/parse-limit.ts`) applied to all 16 list-controller sites — NaN/blank→fallback, fractional truncated, clamped to [1,max]. Test: `parse-limit.spec.ts`.
- [ ] BigInt-in-JSON: latent only (raw-BigInt methods have no callers) — wire serialization before exposing them.

---

## Platform migration (see `docs/deployment-architecture.md`) — pending decision confirmation

- [ ] Confirm: stack (keep NestJS vs .NET rewrite), web host (Railway vs CF Workers), backend host (Railway container-lift).
- [~] Provision Railway: ✅ project `scadium` + Postgres + Redis created; ⛔ compute services BLOCKED on a paid plan (free-tier limit). **Host comparison done** (`docs/deployment-architecture.md`): Railway wins on price+fit (~$20-27/mo, never-sleeps, managed PG+Redis) vs Render/Fly (~$60), AWS (~$100), Coolify (~$17 but self-managed DBs). io.net ruled out. → upgrade Railway Hobby to deploy.
- [ ] Cloudflare edge: proxied records → Railway origins, SSL Full (strict), WAF, cache rules, auth rate-limit, geo trusted-proxy Transform Rule.
- [ ] Cut over DNS; verify WS proxy, geo headers, health probes.

## Process / CI gaps (owner decision)

- [ ] **audit-status CI gate is now a silent pass.** `scripts/audit-status-gate.sh` blocks real-money cutover on open critical/high security findings filed as GitHub issues (`type:security` + `phase:M`), but we moved findings to `BACKLOG.md` — so the gate always finds 0 and passes. Options (owner's call): (a) re-point it at BACKLOG.md's Tier-2 real-money section but gate only a release/cutover branch (not every PR, which would halt dev while blockers are open); (b) keep filing the *real-money cutover* criticals as phase:M issues at cutover time; (c) accept the gate as dormant until the GitHub-issue flow resumes. Not fixed unilaterally — it changes the CI contract.
- [ ] **Daily case / cashback pay nothing in play-money mode** (roadmap #3) — this is a DELIBERATE design choice (`#28`: "explicit non-value record… never presented as a paid claim"), not a bug. Whether play-money $SCAD rewards should credit `scadiumBalance` directly (making the rewards hub pay real off-chain) is a tokenomics decision for the owner.
