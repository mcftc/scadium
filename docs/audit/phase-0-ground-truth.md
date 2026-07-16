# Scadium — Phase 0 Ground-Truth Audit (origin/main #365)

**Date:** 2026-07-16 · **Commit audited:** `adcd91d` (origin/main, PR #365) · **Method:** independent code read of every subsystem + 15-agent adversarial audit (2–3 refutation voters per money/security/compliance finding) + live black-box probing against a booted API. The **code is the source of truth**; `ANALYSIS.md`/`CLAUDE.md` were treated as unverified hints.

> **Provenance note.** Local `main` had drifted **183 commits behind** origin/main at session start (was at PR #59). This report is the re-baseline on the *current* code. Every finding below carries a status: **CONFIRMED** = ≥2 independent adversarial voters or my own live/static proof; **read-confirmed** = single-reader + my static read; a few HIGH availability items are my-static-confirmed where the automated verifier was cut off by a session limit and I verified them by hand.

---

## 1. What Scadium actually is today

A **play-money, provably-fair Solana casino** that is far more mature and better-engineered than its own docs suggest. NestJS 11 + Express 5 API, Next 16 App-Router web, a real BullMQ worker, four Anchor programs (built, IDL + keypairs committed, **none deployed** — verified null on devnet & mainnet), Postgres 16 via Prisma, Redis as a hard dependency (nonce store, throttler, Socket.io adapter, distributed locks, leader election).

**12 games** across three engine styles: request-driven transactional (coinflip), singleton in-memory loops with Redis leader election (crash 20 Hz, jackpot, lottery, blackjack), and a uniform stateless/stateful instant-settle layer (dice, limbo, hilo, mines, plinko, tower, wheel). A `$SCAD`/USDS reward economy (staking, hourly dividends, block mining, vault, airdrop, affiliates) sits on top. Real money is a **fail-closed boot toggle** (`REAL_MONEY_ENABLED` → `assertRealMoneyReady`), and a compliance stack (geo, KYC, responsible-gambling, age gate, licensing) is genuinely wired — but currently dormant because the chain and real-money flag are off.

**The engineering floor is high.** These are genuinely production-grade and should NOT be re-litigated:

- **Ledger core** — `apps/api/src/prisma/apply-balance-delta.ts` is the single mutation point for all 5 balance currencies; debits use a guarded conditional `updateMany(where balance gte amount)` (row-lock, can't go negative or double-spend) + an append-only `BalanceLedger` row in the same tx. 44 call sites; no bare `{decrement}` on a play balance anywhere.
- **Concurrency** — `withSerializable` (Serializable + P2034/40001/40P01 retry) wraps settlements; `settle-claim.ts` status-CAS closes double-settle; idempotency keys claimed inside the debit tx. I **live-verified** the coinflip double-join CAS (2nd join rejected), the negative-balance guard (20 concurrent 1-SOL bets floor at exactly 0), and reward-claim idempotency (chain-gated + #214 reserve rework).
- **Multi-instance safety of the money layer** — Redis leader election (`redis/leader-election.ts`, compare-and-extend Lua, fail-closed) + a correct atomic `SET NX PX` lock; BullMQ repeatable schedulers are idempotent by scheduler id; there's a real **kill-9 chaos e2e** that boots 2 replicas, SIGKILLs the leader's Redis, and asserts the follower refunds stranded bets with zero drift.
- **Auth/security** — SIWS over a canonical message with a Redis one-time nonce; 15m access JWT bound to a `Session` row + rotating refresh with reuse-detection; admin routes role-checked; throttling Redis-backed; gateways broadcast-only (no money mutation over WS). I confirmed admin is 401/403-guarded live.
- **Fairness** — one HMAC-SHA256 primitive, commit-reveal, per-user rotating seeds with a monotonic nonce; **three independent implementations** (Node, browser WebCrypto, Rust) locked to golden fixtures in CI.
- **Test estate** — 15 fair-vector suites, 53 API unit specs, **90 integration e2e against real Postgres+Redis** (incl. 50-way balance-race, 20-way double-spend, coinflip-race, kill-9 recovery), Rust golden-lockstep, Playwright. CI gates 8 jobs incl. a real-money `audit-status` gate.

Against that floor, the completed adversarial audit confirmed **5 critical and 32 high** real defects (127 findings total, **0 refuted**, 7 downgraded/overstated). They cluster in the *newer* surfaces (blackjack bet-lifecycle, the instant-games seed-rotation seam, the whole on-chain settlement bridge, hourly-job scheduling, horizontal scaling) and in **product copy**.

---

## 2. Backend correctness — confirmed defects

### CRITICAL (money/fairness — some live in play-money mode today)

**C1 — Blackjack rebet during the 5 s "settled" pause refunds an already-settled stake.** `settle()` credits payouts and sets `phase='settled'` but never clears `seat.bet`; the only clear is a 5 s `SETTLE_PAUSE_MS` timer. `placeBet()` explicitly allows `phase==='settled'`, so a fast rebet reads the stale settled bet as `previousTotalLamports`, which the service credits back as a "refund" — deterministic, riskless money creation on every fast rebet (lose → stake returned; win → 2× payout *plus* stake returned). **Live play-money path, no chain needed.** `blackjack.engine.ts:555, 996, 1182` + `blackjack.service.ts:115`. *CONFIRMED ×3 + my read.*

**C2 — Other seats' stale bets ride the next blackjack round free.** When a rebet during the pause reopens betting, `openBetting`'s per-seat reset loop resets cards/status but **not** `s.bet`, and the pause-timer clear is skipped (phase already flipped to `betting`). Every other seated player's previous bet silently rides the new round with **zero fresh debit** — a loss costs nothing, a win is paid from money never staked. Farmable with two accounts on one table. `blackjack.engine.ts:651-659`. *CONFIRMED ×3.*

**C3 — Seed rotation leaks the active server seed mid-round → deterministic wins in mines/tower/hilo.** `rotateServerSeed` reveals the currently-active server seed with **no check for an in-progress stateful round** (`fairness/seed-manager.service.ts:95`). Because the mines/trap/card layout is committed from that exact active seed and the round view exposes nonce + clientSeed, a player can: start a round → `POST /fairness/seed/rotate` → recompute the full layout → finish for a guaranteed max win. **Live play-money fairness break.** `stateful-round.ts:189`. *CONFIRMED ×3.*

**C4 — Reward/dividend claim double-pay on a missed confirmation.** `ChainService.claimReward/claimDividend` swallow **all** send errors to `null`; a transfer that lands on-chain but whose confirmation is lost is treated as a transient failure. Every retry then fails deterministically on the already-initialized `ClaimRecord` PDA (plain `init`, no existence probe), and after 5 attempts the failed-path **restores the reserve to spendable balance** — user keeps the on-chain tokens *and* the balance, re-claimable under a fresh `Date.now()` period. Gates real money. `rewards.service.ts:384`, `chain.service.ts:965`. *CONFIRMED ×3.*

> **Reconciliation note.** My first-pass draft listed a 5th critical — "on-chain `settleBet` is dead code → deposit/lose/self-withdraw drains the house." The completed adversarial pass **downgraded it to MEDIUM** (still CONFIRMED): the exploit chain requires vault custody to be turned on, which is separately gated (undeployed programs + cosigner disabled in prod + the real-money flag), so it is a real-money *cutover blocker*, not a live drain. It now lives in §3 as **H5b**, alongside a newly-surfaced HIGH (`verifyVaultTransfer` forged events).

### HIGH — money & correctness

- **H1 — Blackjack restart during betting confiscates all accepted stakes.** Debit commits at bet time but the bet lives only in engine RAM until `deal()` persists `stateJson`; boot recovery parses the still-empty `{}` into zero refunds. The comment claiming service-side refunds is false. `blackjack.engine.ts:755`. *CONFIRMED ×2.*
- **H2 — Coinflip `cancel()` TOCTOU duplicates money.** Non-locking `findUnique` status check + **unconditional `update` by id** (no status guard) in a Read-Committed tx; a cancel racing a join refunds the creator *after* the flip settled and overwrites `completed`→`cancelled`. The join path got a CAS; cancel was missed. `coinflip.service.ts:465`. *CONFIRMED ×2 + my static read.*
- **H3 — Crash auto-cashout can pay ZERO below the bust point.** Auto-cashout fires only if a ~50 ms tick lands in `[target, bust)`; near 2× the multiplier moves 0.01 per ~21 ms, so `autoCashout=2.02, bust=2.03` can miss every tick and lose the whole stake despite fair-verification saying the player won. Also underpays 0.01× via `BigInt(Math.floor(m*100))`. `crash.engine.ts:374`. *CONFIRMED ×2.*
- **H4 — Lottery never pays winners in the default (chain-disabled) mode.** `buyTicket` debits `playBalanceLamports` per ticket, but settle only writes `payoutLamports`/`won` onto Bet/ticket rows with **no `applyBalanceDelta` credit**; every payment path no-ops when `chain.lotteryEnabled` is false. The house silently keeps 100 % of every winning ticket. `lottery.engine.ts:771`, `lottery.service.ts:259`. *CONFIRMED ×2.*
- **H11 — All "hourly" settle jobs settle the *current* in-progress hour on partial data.** The worker fires airdrop/distribution/block-mining/vault-accrual **every 5 minutes** while each targets `periodForHour(Date.now() - 60_000)`; the first fire >1 min into an hour settles that hour with only ~5 min of data, permanently excluding the rest, and the airdrop then **rejects all tips for ~55 min** ("This hour's pool already settled" → 500). No backfill, so worker downtime strands hours. `airdrop.engine.ts:145`, `distribution.service.ts:44`, `block-mining.service.ts:56`, `apps/worker/src/main.ts:156`. *CONFIRMED ×2.*
- **H13 — Reward claim `period = Date.now()` defeats its own idempotency guard.** `@@unique([userId,kind,period])` and the on-chain `ClaimRecord` PDA both key on `period`, but wagerReward/cashback/dividend use a per-request millisecond timestamp (only dailyCase uses a fixed `YYYYMMDD`). This is the root enabler of C4's re-claim. `rewards.service.ts:56,147`. *read-confirmed (money-safety + rewards summaries).*
- **H18 — Affiliate commission accrues but has no payout path.** Commission accrues only from crash + coinflip settlements (the other ~10 games never call `creditReferral`), and there is **no claim/payout code anywhere** — the web dashboard shows "Commission earned" in SOL that can never be received. *read-confirmed.*
- **H20 — RG limits bypassed on coinflip/lottery.** `coinflip.join` and lottery buys pass `0n` to `rg.assertCanWager`, so self-set daily wager/loss limits never constrain those games from the same balance. `coinflip.service.ts:151`. *read-confirmed.*

### In-memory / worker / restart state (answers to the brief's specific questions)

- **Auth nonces:** Redis (5-min TTL, atomic one-time-use) — *not* in-memory. Multi-replica safe. ✅
- **Chat limiter:** Redis sorted-set sliding window, holds across replicas. ✅
- **Always-on loops:** crash (20 Hz), jackpot/lottery timers, blackjack sweep, bot driver. All leader-gated **except the demo-bot driver** (`bots/bot.service.ts:71`, DEMO_BOTS only → N replicas = N× bot volume; must never run on mainnet).
- **Worker/queues:** 9 BullMQ queues, idempotent schedulers, correct locks. **But `docker-compose.prod.yml` ships no worker container** (H19) — the single-VPS path runs *zero* background jobs (pools never distribute, claims never sweep, solvency never checked).
- **Settlement failures:** `SettlementFailure` rows are written but **have no consumer** anywhere — the "recovery worker" the comments reference doesn't exist; a settle failure freezes that game in-process.

---

## 3. On-chain layer & the real-money gate

The Anchor programs are real, defensively-written code (signer/owner checks, seed-constrained PDAs, overflow-checks, CPMM inflation guards) but **inert in every runnable config** (undeployed; cosigner hard-disabled in production `NODE_ENV` because the KMS provider is unimplemented). The seams that matter for a real-money cutover:

- **H9 — The real-money gate isn't coupled to what actually makes money real.** `assertRealMoneyReady` fires only on `REAL_MONEY_ENABLED=true`. A non-production `NODE_ENV` deploy with `SOLANA_NETWORK=mainnet-beta` + RPC + `VAULT_PROGRAM_ID` + a file cosigner turns on **real-SOL vault deposits** (`chain.enabled=true`) with **KYC failing open** and no licence/geo/KYC gate ever evaluated. `real-money-gate.ts:23`. *CONFIRMED ×2.*
- **H10 — All four program deploy keypairs are committed to git** (`target/deploy/*-keypair.json`, force-un-ignored) and are the private keys of the declared program IDs. Anyone with repo access can deploy arbitrary code at those IDs. The IDs are **burned** and must be regenerated with fresh, uncommitted keypairs before any deploy. *CONFIRMED ×2.*
- **H5 — `verifyTicketTx` trusts forged events.** Parses `TicketBought` from *any* `Program data:` log line matching only the 8-byte discriminator, without checking the emitting program — a lookalike program can mint free tickets that compete for real `$SCAD` prizes. `chain.service.ts:884`. *CONFIRMED ×2.*
- **H6 — `POST /lottery/faucet` drains the cosigner.** Transfers 100 real `$SCAD` from the cosigner to any authenticated caller, gated only on `chain.lotteryEnabled` — no devnet check, no admin, no per-user limit. `lottery.service.ts:214`. *CONFIRMED ×2.*
- **H7 — The on-chain daily draw can structurally never reveal.** `target_slot` is pinned at sales-open (+50 slots ≈ 20 s) but reveal runs ~24 h later, long past the ~512-slot (~3.4 min) SlotHashes window → every draw falls back to the operator-deterministic "synthetic-not-fair" path and `pay_prize` (requires `Revealed`) fails forever. `lottery.engine.ts:401`. *CONFIRMED ×2.*
- **H8 — Restart/leader-flap settles the open lottery draw early.** `recoverStrandedDraws` selects all `status='open'` with **no `drawAt` filter** and settles immediately, so every deploy resolves the advertised 12:00 draw hours early with a truncated sales window. `lottery.engine.ts:191`. *CONFIRMED ×2.*
- **H5a — `verifyVaultTransfer` trusts forged vault events.** Like the lottery bug, it parses `parseVaultEvent`'s log scan and **never asserts the confirmed tx actually invoked `VAULT_PROGRAM_ID`** (no account-key/program-id check, no lamport-delta verification), so a lookalike program's forged deposit event could credit a user vault that received no real SOL. `chain.service.ts:227`. *CONFIRMED ×2.*
- **H5b — The value-moving on-chain settlement bridge is unwired** (downgraded from my draft's C4 to MEDIUM by the verifier, but it's the key real-money-cutover gap). `ChainService.settleBet` → `scadium_vault settle_bet` has **zero runtime callers** — every engine fires only the zero-lamport `recordBet` receipt — so net play is never swept between user vaults and the house vault. Once custody is enabled a loser could self-withdraw their untouched deposit (`scadium_vault` withdraw needs only the owner's signature; `confirmWithdraw` just logs "drift") and a winner's vault is never funded. The `fundedDrift/chainDrift/vaultDrift` monitors that would catch it are **never scheduled** by the worker. `chain.service.ts:291`, `vault-bridge.service.ts:97`. *CONFIRMED (medium).*
- **Reward reserve/restore movements write no ledger row** (`reserved` isn't a modeled currency), so once chain is on, `scadLedgerDrift`/`usdsSolvency` will false-positive and stop being trustworthy monitors. *read-confirmed (money-safety summary).*
- **Swap/token module (`gap` probe, unverified):** `recentTrades` trusts forged `Swapped` events (same class as H5a/H5); `runBuyAndBurn` isn't crash-idempotent (the `TokenBurn` row defining the next NGR window is written only after the burn); and the burn step **burns the entire cosigner SCAD ATA** — the operational float — rather than the swap-output delta. Real-money concerns for the SCAD/SOL pool + buy-and-burn if enabled. `swap.service.ts`. *unverified — flag for follow-up.*

---

## 4. Web UX / product-copy reality

The **honest-copy plumbing is genuinely good and tested**: on-chain claims render through `ChainCopy`/`useChainEnabled` (fail-closed `false`), the footer licence line only shows a regulator when `/compliance/config` says licensed (Playwright-covered), and the age gate / legal gate / cookie consent / geo middleware / RG page / KYC page all exist. **But several hardcoded claims escape the gating and are false today** (H17, compliance risk on a gambling product):

- **"Audited: Yes"** (`hero-section.tsx:53`) — `audits/README.md` says the audit is *pending engagement*.
- **RTP overstated on six games** — grid advertises Limbo/Mines/Tower **99%**, Hi-Lo **98%**, Wheel/Plinko **96.5%**, Dice **99%**, but `HOUSE_EDGE=0.05` → **95%** for all edge-based games (`games-grid.tsx:62` vs `constants.ts:15`).
- **"on-chain VRF"** (no VRF exists — it's SlotHashes commit-reveal), **"every fill is a real transaction"** (trade page), the promo bar's **"on-chain AMM"**, and the hero **"On-Chain Games / ~400 ms Settlement"** badge — all describe capabilities the running system doesn't provide.

Other web facts:
- **Error/loading UX is thin:** a single root `app/error.tsx`, **no `not-found.tsx`, no `global-error.tsx`, no `loading.tsx`**; no toast lib (errors surface inline). Acceptable but bare.
- **Reconnect gap (H16):** only blackjack + chat resync after a WS reconnect; **crash seeds from REST once on mount** and never re-syncs, so a drop across the waiting→running transition leaves phase stuck at `waiting` and **disables the cash-out button** for a live stake — direct fund-loss risk on every rolling deploy once money is real. `use-crash.ts:63`. *my static read.*
- **Config:** `resolveNetworkConfig` is fail-closed (devnet default, hard-errors on mainnet without explicit RPC). **`metadataBase` is hardcoded `https://scadium.io`** while the production domain is **scadium.com** — a real mismatch to fix in the migration. `next.config.mjs` `images.remotePatterns` is a **wildcard** → open paid image-proxy risk.
- **SEO weak:** no `robots.txt`, no sitemap, no OG image, no `public/` dir; `/` 307-redirects to `/crash`, leaving `/about` the only indexable marketing surface.
- **a11y:** decent basics (lang, aria-labels, role=dialog) but **no modal focus-trap and no skip-nav**.

---

## 5. Cloudflare-relevant facts (for Phase 2 — not decided here)

- **Domain:** scadium.com, NS delegated to Cloudflare (full delegation confirmed by you). `metadataBase` still says scadium.io — fix.
- **Backend is strictly container-shaped, NOT Workers-shaped:** singleton 20 Hz in-memory game loops, persistent Socket.io namespaces, a BullMQ worker over ioredis, native Prisma engine, `@solana/web3.js`, `setTimeout` slot-polling. It does not lift to Workers. The real fork is **(A) container-lift** (Cloudflare in front for DNS/WAF/CDN + WS proxy) vs **(B) Durable-Objects rewrite** (a DO per live round/table + Hibernation).
- **Ordinary horizontal scaling is already broken (H12).** Leader election makes ≥2 replicas *safe* but not *functional*: there's **no request-forwarding to the leader**, so follower pods hold a placeholder crash round (id `''`) and empty blackjack tables — crash bets 500 (invalid-UUID), cash-outs 400, jackpot/lottery/blackjack actions reject on ~(N-1)/N of requests. The Helm chart nonetheless ships `replicas: 2`, HPA 2–8. *This is a decisive input:* today the API must run **single-instance** (or with sticky routing to the leader), which is exactly the pain the DO model (one authoritative instance per round) solves natively — worth weighing in Phase 2.
- **DB is already Postgres via Prisma** — a migration would be provider + pooling only (Hyperdrive + Prisma driver adapter, or Neon/Supabase), not a DB rewrite. Keep Prisma.
- **The web is already Cloudflare-aware:** geo middleware reads `cf-ipcountry`, Socket.io is websocket-only against a separate API origin (CF ~100 s idle WS timeout survivable via ping). `trust proxy: 1` must become a CIDR/hop-count config behind CF; the Caddyfile must inject/strip the geo trusted-proxy header.
- **Stack question (.NET 10):** the fair engine already maintains **three byte-identical implementations** (Node/browser/Rust) proven by golden fixtures, so a C# port is *technically* low-to-moderate risk (9 of 13 derivations are integer/bigint; crash & limbo use portable-but-rounded float ops). But the golden fixture is only 3 vectors and omits dice/limbo/wheel/plinko, and **none of the Phase 0 defects are language problems** — they're logic/lifecycle bugs that a rewrite would have to re-solve from scratch while re-deriving a working, well-tested codebase. Full analysis in Phase 2.

---

## 6. Independent production-readiness list (my own, not any prior roadmap)

**Blocking for play-money integrity (live bugs, fix first):**
1. C1+C2 blackjack bet-lifecycle at settle/reopen (clear `seat.bet` on settle; debit every riding bet).
2. C3 seed rotation must refuse while any stateful round is active (or derive committed layout from a *retired* seed).
3. H2 coinflip cancel → guarded CAS / `withSerializable`.
4. H3 crash auto-cashout must pay the committed target when target < bust, independent of tick timing; fix the 0.01× rounding.
5. H1 blackjack restart-during-betting stake loss; H11 hourly-job cadence (move to true top-of-hour Cron/scheduler + target only *elapsed* hours + backfill); H20 RG bypass; H18 affiliate payout path or remove the claim UI.

**Blocking before flipping real money (in addition to the above):**
6. H5b wire `settleBet` (sweep net play into/out of the house vault) + schedule the drift monitors; H5a assert `VAULT_PROGRAM_ID` + lamport-delta in `verifyVaultTransfer`; audit the swap forged-events/buy-and-burn issues.
7. C4+H13 fix the claim confirmation/idempotency (fixed period bucket + on-chain existence probe before restore).
8. H4 credit lottery winners in chain-disabled mode (or disable the game); H5/H6/H7/H8 on-chain lottery holes; H9 couple the real-money gate to mainnet-custody config; H10 regenerate program keypairs.
9. Route reward reserve/restore through the ledger so solvency monitors stay trustworthy.
10. Legal: real KYC/geo/age/licence enforcement exercised end-to-end (the plumbing exists; prove it in the money path), + a completed third-party program audit & pentest.

**Product-copy / compliance (do before any public launch, cheap):**
11. H17 remove/gate "Audited: Yes", fix the six RTP figures to 95 %, drop "on-chain VRF"/"real transaction"/"~400 ms on-chain settlement"/"on-chain AMM" until true.

**Ops / platform (Phase 2/3):**
12. H12 single-instance-or-forwarding decision (folds into the Cloudflare A-vs-B choice); H16 crash reconnect resync; H15 add `x-geo-proxy-secret` to pino redaction; H19 ship the worker on every deploy path; graceful shutdown (SIGTERM → drain loops/sockets); lock down public `/metrics`; a real image-publish/CD pipeline; SEO scaffolding (`robots`/sitemap/OG, `metadataBase`→scadium.com).

**Lower-severity hygiene (from the completeness-critic gap probes):**
13. Avatar `avatarUrl` accepts up to 120 KB of client-supplied data-URL with only a prefix regex and no image-decode validation — stored-payload/DoS surface (`users.service` updateProfile). List endpoints convert `?limit` with raw `Number()`/`parseInt()` so `?limit=abc`→NaN survives the clamp (minor DoS). BigInt-in-JSON is only latent (the two raw-BigInt methods have no callers today) — safe now, but wire serialization before exposing them.

---

*This document is the Phase 0 deliverable. Phases 1 (Cloudflare tooling) and 2 (written migration + stack recommendation) follow, then Phase 3 turns this list into GitHub issues via `/plan`.*
