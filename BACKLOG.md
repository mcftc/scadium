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
- [ ] **H5b · On-chain settlement bridge unwired.** `settleBet` has zero callers → net play never sweeps between user/house vaults (loser self-withdraws deposit; winner unfunded). Wire it + schedule the `fundedDrift/chainDrift/vaultDrift` monitors. `chain.service.ts:291`, `vault-bridge.service.ts:97`.
- [ ] **H5a · `verifyVaultTransfer` trusts forged events.** Assert the confirmed tx invoked `VAULT_PROGRAM_ID` + verify lamport delta. `chain.service.ts:227`.
- [ ] **H4 · Lottery never pays winners in default (chain-disabled) mode.** Settle writes payout onto rows but never credits balance. Credit via `applyBalanceDelta` (or disable the game off-chain). `lottery.engine.ts:771`.
- [ ] **H6 · `/lottery/faucet` drains the cosigner.** 100 $SCAD to any caller, no devnet/admin/limit guard. `lottery.service.ts:214`.
- [ ] **H5 · `verifyTicketTx` accepts forged `TicketBought` events** from any program. `chain.service.ts:884`.
- [ ] **H7 · On-chain daily draw can never reveal** (`target_slot` expires before reveal → synthetic fallback, `pay_prize` fails forever). Re-pin the slot near reveal. `lottery.engine.ts:401`.
- [ ] **H8 · Restart settles the open lottery draw early** (`recoverStrandedDraws` has no `drawAt` filter). `lottery.engine.ts:191`.
- [ ] **H9 · Real-money gate not coupled to mainnet-custody config.** A non-prod `NODE_ENV` + mainnet + program id + file cosigner enables real deposits with KYC failing open. `real-money-gate.ts:23`.
- [ ] **H10 · Program deploy keypairs committed to git** → IDs burned. Regenerate fresh, uncommitted keypairs before any deploy. `target/deploy/*-keypair.json`.
- [ ] **Swap module (unverified) ·** forged `Swapped` events in `recentTrades`; `runBuyAndBurn` not crash-idempotent; burn burns the entire cosigner ATA. Audit + fix before enabling the pool. `swap.service.ts`.
- [ ] **Reward reserve/restore writes no ledger row** → false solvency drift once chain is on. Route through the ledger (or add a reserved-aware drift rule).
- [ ] **Legal ·** KYC/geo/age/licence enforcement exercised end-to-end in the money path (plumbing exists); completed third-party program audit + pentest before real funds.

## Tier 3 — Product copy / compliance (cheap; before any public launch)

- [ ] **H17 · False capability/audit/RTP claims.** Remove/gate "Audited: Yes" (`hero-section.tsx:53`); fix six RTP figures to 95% (`games-grid.tsx:62`); drop "on-chain VRF", "every fill is a real transaction", "~400 ms on-chain settlement", "on-chain AMM" until true.

## Tier 4 — Ops / platform (with the Railway + Cloudflare cutover)

- [ ] **H16 · Crash client has no reconnect-resync** → live stake stranded with cash-out disabled on every WS drop/redeploy. Re-fetch `/crash/snapshot` on `connect`/`reconnect`. `use-crash.ts:63`. *(Do before any redeploy-heavy platform.)*
- [ ] **H12 · API is effectively single-instance** (leader election, no request-forwarding). Run 1 `api` replica on Railway; add sticky routing / leader-forwarding only if HA is needed later.
- [ ] **H15 · pino redaction omits `x-geo-proxy-secret`** → geo-bypass credential leaks to logs. Add it to the redaction list. `logging/pino.config.ts:18`.
- [ ] **H19 · Prod compose ships no worker** → background jobs never run on that path. Ensure the `worker` service ships on Railway.
- [ ] Graceful shutdown (`enableShutdownHooks` + SIGTERM → drain loops/sockets/queues); lock down public `/metrics`; SEO scaffolding (`robots`/sitemap/OG); `metadataBase` → `scadium.com`; lock `images.remotePatterns`.

## Tier 5 — Hygiene (low)

- [ ] Avatar `avatarUrl`: 120 KB client data-URL, prefix-regex-only validation, stored in Postgres → move to a Railway bucket + decode-validate + size-cap. `users.service` updateProfile.
- [ ] List endpoints: `?limit` via raw `Number()`/`parseInt()` → `NaN`/fractional survive the clamp; validate via DTO.
- [ ] BigInt-in-JSON: latent only (raw-BigInt methods have no callers) — wire serialization before exposing them.

---

## Platform migration (see `docs/deployment-architecture.md`) — pending decision confirmation

- [ ] Confirm: stack (keep NestJS vs .NET rewrite), web host (Railway vs CF Workers), backend host (Railway container-lift).
- [ ] Provision Railway: `web`, `api` (×1), `worker`, Postgres, Redis, bucket; wire env/secrets.
- [ ] Cloudflare edge: proxied records → Railway origins, SSL Full (strict), WAF, cache rules, auth rate-limit, geo trusted-proxy Transform Rule.
- [ ] Cut over DNS; verify WS proxy, geo headers, health probes.
