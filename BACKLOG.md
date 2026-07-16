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

## Tier 4 — Ops / platform (with the Railway + Cloudflare cutover)

- [x] **H16 · Crash client has no reconnect-resync** → ✅ Fixed: a `connect` handler re-fetches `/crash/snapshot` and authoritatively resyncs round state on every (re)connect, so a WS drop across the waiting→running transition can't strand a live bet with the cash-out button disabled. `use-crash.ts`.
- [ ] **H12 · API is effectively single-instance** (leader election, no request-forwarding). Run 1 `api` replica on Railway; add sticky routing / leader-forwarding only if HA is needed later.
- [x] **H15 · pino redaction omits `x-geo-proxy-secret`** → ✅ added to `REDACTED_PATHS` (`pino.config.ts`); `redaction.spec.ts` asserts it's scrubbed.
- [x] **H19 · Prod compose ships no worker** → ✅ Fixed: added the `worker` service to `docker-compose.prod.yml` (Helm's `worker.yaml` already covered the k8s path). All 9 BullMQ queues now run on the single-VPS path too.
- [~] Graceful shutdown ✅; `metadataBase`→scadium.com ✅; SEO `robots.ts`+`sitemap.ts` ✅; `images.remotePatterns` locked (`[]`, was wildcard) ✅; **public `/metrics` token gate ✅** — optional `METRICS_TOKEN` bearer guard on the scrape endpoint (open when unset for private/edge-blocked scrapes; Caddy/Railway forward every path so network isolation alone didn't cover it). `metrics.controller.ts` + `metrics.controller.spec.ts`. Belt-and-suspenders with the documented Cloudflare WAF rule. Remaining: OG images.

## Tier 5 — Hygiene (low)

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
