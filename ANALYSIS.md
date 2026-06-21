# Scadium — Deep Analysis (Gaps, Missing Features & Roadmap)

> Generated 2026-06-09 from a 12-agent deep audit (9 subsystem analysts + 3 synthesis passes) over the full monorepo.
> Scope: `apps/web`, `apps/api`, `packages/{fair,shared,ui}`, `programs/` (Anchor), `infra/`, Prisma schema + 15 migrations.

---

## 1. Executive verdict

**Scadium is an impressively complete *play-money* crypto-casino prototype with a *decorative* on-chain layer — not a real-money casino.** The product surface (24 routes, 5 games, realtime feeds, token/LP/lottery, profile, settings, multi-wallet, mobile) rivals a solpump.io/bc.game clone in breadth and polish. But every casino game settles against an **off-chain Postgres play balance** (`User.playBalanceLamports`, seeded at 10 SOL), while the Anchor programs — though genuinely well-written — are **unbuilt, undeployed, and disconnected** from that balance. On-chain `settle_bet` emits a receipt that moves **0 lamports** for the vast majority of bets, yet the UI/whitepaper claim "every payout settled on-chain."

**Honest maturity by subsystem:**

| Subsystem | Grade |
|---|---|
| On-chain layer (vault/swap/lottery + API wiring) | prototype |
| Crash game | beta |
| Coinflip / Jackpot / Lottery | alpha |
| Blackjack | alpha |
| Auth / Wallets / Balance ledger | alpha |
| Token economy / rewards / affiliates / airdrop | prototype |
| Provably-fair engine + shared contracts | alpha |
| Web app (product surface) | beta |
| Data model / infra / CI / security | alpha |

**Risk tally:** 5 Critical · 10 High · 9 Medium · 5 Low.
**Feature tally:** 16 done · 22 partial · 6 stub · 33 missing.

The path to real money is **7 sequenced phases (G→M)**. Do **not** flip on real funds until the gating checklist in §8 is fully green.

---

## 2. What is genuinely built and solid (don't redo this)

- **Provably-fair cryptographic core.** `HMAC-SHA256(serverSeed, "${clientSeed}:${nonce}")` is the single derivation point (`packages/fair/src/hash.ts`). Node `crypto` and browser WebCrypto (`apps/web/src/lib/fair-browser.ts`) produce **bit-identical** output. Every formula (crash 5% edge/max ~162000x, coinflip 50/50, blackjack infinite-deck, jackpot, lottery) was independently reproduced and matches.
- **Lottery 3-way lockstep.** Byte-for-byte golden-vector parity between TypeScript, the browser verifier, and the on-chain Rust derivation (`programs/scadium_lottery/src/lib.rs:269-298`). The strongest fairness story in the repo.
- **Anchor programs are real and architecturally sound** (just not deployed): `scadium_vault` has a genuinely **non-custodial** withdraw (owner-signature-only; cosigner can never move user funds out), `scadium_swap` is a correct floors-toward-pool CPMM with sqrt-LP, `scadium_lottery` is commit-reveal with in-program number derivation and a `ClaimRecord` PDA that blocks double-claims.
- **Crash engine.** Server-authoritative 20Hz loop (betting → tick → bust → settle → next), partial/auto/scheduled cashout, and the previously-flagged **bust-point WS leak is genuinely fixed** (`crash.engine.ts` — `crash:running` no longer carries the bust point).
- **Correct house-edge math.** Coinflip pays exactly 1.9× from a 2× pot (5% edge); jackpot winner takes 95%; lottery uses bc.game fixed prizes.
- **SIWS auth done right** (the verify side): correct `tweetnacl` ed25519 verification, canonical message re-derivation from stored `issuedAt`, one-time nonce consumption.
- **Money typed as `BigInt` lamports end-to-end**; clean, sequenced Prisma migrations; replay/idempotency unique constraints on the on-chain paths (lottery `txSignature+txIndex`, reward claims, airdrop claims).
- **Full, polished web surface.** All 24 routes built and wired to API + Socket.io — **no live "coming soon" stubs** (the `ComingSoonPage` component is dead code). Mobile-responsive, optimistic cache patching, reels/charts.
- **SCAD Vault (term staking) — Faz 1+2 built.** Share/index (ERC-4626-style) term pools with hourly NGR-funded yield, early-exit penalty, REST API + `/vault` UI (live earnings counter), and a Rust on-chain twin (`init_vault_pool`/`vault_deposit`/`vault_withdraw`/`vault_accrue`, math bit-for-bit `@scadium/shared`). The Engine was made **liquid** (instant unstake) so the Vault is the locked tier. NGR redistribution rebalanced to ≤ 20% (Engine 6% + burn 6% + Vault 8%). Off-chain-first: `ChainService.vault*` is cosigner-gated/decorative until deploy; `vaultLedgerDrift()` proves the off-chain invariants. Remaining: real DeFi yield (jitoSOL/Kamino — Faz 3) needs mainnet + audit + a resolved deploy (devnet-SOL blocker, see `docs/runbooks/vault-onchain.md`).

---

## 3. The defining gap — play-money vs. the marketing claim

This is the single most important finding and the spine of the roadmap:

- Every casino game debits/credits `User.playBalanceLamports` in Postgres. **The on-chain vault (deposit/withdraw of real SOL) is never reconciled with that balance.** Depositing real SOL gains you nothing playable; play winnings can't be withdrawn. `programs/scadium_vault/src/lib.rs:136-148` emits a full-amount `BetSettled` event while clamping the actual transfer to the user's funded vault balance (= 0 for everyone). **A Solscan receipt does not prove value moved.**
- Marketing copy — footer "Licensed & regulated.", whitepaper/fairness "every payout settled on-chain", per-bet "receipts" — **describes a system that does not exist.** This is both a trust problem and (once real money is involved) a legal one.

**Decision required:** either (a) commit to wiring real on-chain custody (Phases G→M), or (b) explicitly label the product play-money and gate all "on-chain settled / licensed" copy behind a real `chain-enabled` flag. You cannot ship the current copy with real funds.

---

## 4. Critical risks (5) — fix before *anything* touches real value

1. **Balance-mint via negative tip.** `airdrop` `TipDto` validates `amountLamports` with `@IsNumberString()` (accepts `"-1000000000"`); `tip()` checks `balance < amount` (a negative always passes) then `decrement: amount` → decrementing by a negative **increments** the balance. Any authed user mints unlimited play balance and poisons the shared airdrop pool. `airdrop.controller.ts:8-11,30-36`. **Fix:** `@Matches(/^[1-9]\d*$/)` + `if (amount <= 0n) throw` + DB `CHECK`.
2. **Non-atomic settlement.** crash/jackpot/blackjack/lottery settle via `Promise.all(ops)` / `Promise.allSettled(ops)` with a log-only catch — **not** `prisma.$transaction`. A mid-settle error credits a winner without writing the round/Bet rows (or vice-versa); money has moved and is never rolled back. Only coinflip is atomic. `crash.engine.ts:440`, `jackpot.engine.ts:305`, `blackjack.engine.ts:731`, `lottery.engine.ts:392`. **Fix:** wrap each settlement in one `$transaction`; on failure don't advance the round.
3. **Double-spend race.** Balance debits are read-then-decrement with no row lock, no `CHECK(balance>=0)`, no conditional update, default READ COMMITTED. Two concurrent bets both pass the check and both decrement → negative balance; two concurrent coinflip joins both read `status='open'` and pay two winners from one stake. `crash.service.ts:46-56`, `coinflip.service.ts:122-135`. **Fix:** `updateMany({ where: { id, playBalanceLamports: { gte: amount } }, data: { decrement } })` and reject if `count===0`; compare-and-swap status lock for coinflip; DB `CHECK`.
4. **JWT secret fallback → account takeover.** `JWT_SECRET` silently falls back to `'dev-secret-change-me'` with no boot assertion; tokens are stateless with no refresh/revocation (the `Session` model exists but is never used); guard never checks the `typ` claim; token lives in `localStorage`. A prod deploy that forgets the env var signs JWTs with a public secret — anyone forges an admin token. `auth.module.ts:14`, `jwt-auth.guard.ts:33-43`. **Fix:** fail-closed at boot; refresh-token rotation backed by `Session`; validate `typ`; httpOnly cookie.
5. **Custody is simulated (product truth).** As §3 — the vault is disconnected, `settle_bet` moves 0 lamports yet attests the full amount. For a "real-money casino" the entire money-integrity layer is currently theatre. `vault/src/lib.rs:136-148`, `balance-pill.tsx:7-11`.

---

## 5. High risks (10)

1. **Operator can grind fairness outcomes (cardinal sin).** The server generates **both** the `serverSeed` and the "client seed" (`generateClientSeed()` server-side) and computes the result **before** publishing the commit. No `Seed.userId`, no player-set/rotatable client seed, no `SERVER_SEED_ROTATION_INTERVAL`. The commit-reveal is cryptographically valid but cannot stop the house from grinding seed pairs. `crash.engine.ts:209-210`, `schema.prisma:177-191`.
2. **Single-instance trap (no HA).** SIWS nonces (in-memory `Map`), chat rate-limit, and **all** live round state live in one singleton's RAM. **Redis is deployed but has zero client code.** 2+ replicas break SIWS (nonce issued on A fails on B) and spawn N independent crash games with different bust points. `siws.service.ts:28`, `crash.engine.ts:55-67`.
3. **No crash recovery.** Round state is written only at settle; `onModuleInit` just starts a fresh round with no scan for open rounds. A restart mid-round **permanently strands** every debited-but-unsettled bet and every in-RAM cashout; DB rounds stay `running` forever. Affects crash/jackpot/lottery/blackjack. `crash.engine.ts:69-71,347-444`.
4. **Rate limiting is inert.** `ThrottlerModule.forRoot` is configured but `ThrottlerGuard` is **never registered** as `APP_GUARD`. `/auth/nonce`, `/auth/verify`, all bet/cashout/tip/chat endpoints have **zero** throttling. `app.module.ts:30-35`.
5. **Affiliate subsystem is a stub.** No code ever writes a `Referral` row, signup never captures `?ref`, `AFFILIATE` tier constants are unused — counts/volume/commission are always 0. The "commission tiers" are hardcoded marketing. `affiliates.service.ts:22-50`.
6. **Airdrop is trivially sybil-farmable + double-credits.** Eligibility = wagered ≥0.001 SOL AND ≥1 chat msg/hour; wallets are free; each new user starts with 10 SOL. Distribution is a non-atomic `setTimeout` with no unique period — timer + admin `POST /airdrop/run` can both credit the same period. `airdrop.engine.ts:53-176`.
7. **Reward claims lose funds silently.** `claim()` debits `scadiumBalance` inside a tx, **then** fires `claimReward` fire-and-forget. If the chain transfer returns null (chain disabled by default, RPC error, insufficient treasury), the claimable SCAD is consumed with no `txSignature` and no rollback. `rewards.service.ts:44-76`.
8. **Blackjack dealer never peeks.** With no peek on a 10/Ace up-card, a player can hit or **double** into a hidden dealer natural and lose the doubled stake — a real fairness deviation that inflates house take. Split & insurance constants exist but the actions are unimplemented. `blackjack.engine.ts:480-489,541-555`.
9. **Zero compliance for a gambling product.** No age gate, geo-IP block, KYC, self-exclusion, or deposit/loss limits — despite ToS/AML pages claiming them and the footer asserting "Licensed & regulated." Regulatory-shutdown-level exposure. `footer.tsx:84`, `aml/page.tsx:6-23`.
10. **Cosigner hot key on disk.** The key that signs settle/claim/commit/reveal/prize/burn is `readFileSync(JSON)` into the single API process — no KMS/HSM/Vault, no rotation. Host compromise (or a file-read/SSRF bug) exposes settlement + treasury. Dead `HOUSE_WALLET_SECRET_KEY` in `.env.example` invites misconfig. `chain.service.ts:57-58`.

*(9 Medium risks — SIWS message has no domain/chainId binding (replay), swap missing MINIMUM_LIQUIDITY lock, lottery reveal-slot grinding, daily case uses `Math.random()`, aggregate/ledger drift, no migration-on-deploy, pino unwired, devnet links hardcoded, CI lacks security/e2e/Anchor tests — detailed in §7/§9.)*

---

## 6. Top 20 prioritized gaps

| Pri | Effort | Gap |
|---|---|---|
| P0 | XL | Wire on-chain vault ↔ spendable gambling balance (deposit→play, winnings→withdraw) |
| P0 | M | Atomic + idempotent settlement (`prisma.$transaction` + unique constraints) across all games |
| P0 | M | Atomic balance debit: row lock / `CHECK(balance>=0)` / conditional `updateMany` |
| P0 | L | Build, deploy & IDL-generate the 3 Anchor programs (devnet → mainnet) |
| P0 | M | Player-supplied / rotatable client seed + next-seed pre-commitment |
| P0 | L | Crash-recovery / round-resume + persist live cashouts on restart |
| P0 | XL | Compliance gating: KYC, geofencing, age gate, responsible-gambling controls |
| P1 | L | Redis-backed shared state (nonces, chat limits, live rounds) for HA |
| P1 | S | Enforce rate limiting (register `ThrottlerGuard` as `APP_GUARD`) |
| P1 | M | Fix JWT secret fallback + session lifecycle (refresh/revocation/logout-all) |
| P1 | M | Implement affiliate write-path (`?ref` capture, `Referral` rows, commissions, sybil guards) |
| P1 | M | Blackjack dealer peek + split/insurance actions |
| P1 | M | Migration-on-deploy + observability (pino/Sentry/metrics) + readiness probes |
| P2 | S | Provably-fair daily case (replace `Math.random` with seeded HMAC) |
| P2 | M | Airdrop sybil resistance + idempotent distribution + move to durable worker |
| P2 | S | Swap minimum-liquidity lock + buy-and-burn slippage protection (`min_out`) |
| P2 | S | Pin lottery target slot at commit time (stop reveal grinding) |
| P2 | S | Correct misleading copy (on-chain claim, "Licensed & regulated", devnet links) |
| P3 | M | Windowed/cached leaderboards + wager-mining anti-farm caps |
| P3 | M | Web resilience: error/loading/not-found boundaries, toasts, SEO/i18n/a11y |

---

## 7. Feature gap matrix (by category)

**Games** — ✅ Crash · ✅ Coinflip · 🟡 Blackjack (no peek, no split/insurance) · ✅ Jackpot · 🟡 Lottery (prizes unfunded vs pot, demo USDT) · ❌ Dice/Plinko/Mines/Slots/Roulette/Hilo/Wheel · ❌ Sportsbook · ❌ 3rd-party provider aggregator.

**Fairness** — ✅ HMAC commit-reveal · ✅ Cross-language lottery parity · ❌ Player-supplied client seed · ❌ Server-seed rotation/pre-commit · 🟡 Full-hand blackjack verifiability · ❌ On-chain entropy for non-lottery games.

**Wallet/Custody** — ✅ SIWS auth · ✅ Multi-wallet + primary (TOCTOU on set-primary) · 🟡 Vault deposit/withdraw (decorative) · ❌ Vault↔balance bridge · 🔴 Real-money settlement (stub) · 🟡 `settle_bet` amount-proof · ❌ Cosigner KMS/HSM · ❌ Anchor build/deploy · ❌ Multi-asset (USDC/SPL) deposit.

**Economy/Token** — ✅ $SCAD + CPMM swap · ✅ Wager-mining accrual (no anti-farm cap) · ✅ Tokenomics page · 🟡 Buy-and-burn (`min_out=0`) · 🟡 On-chain claim · ❌ Swap min-liquidity lock.

**Rewards/Loyalty** — ✅ Cashback · 🟡 Daily case (`Math.random`) · 🟡 XP/levels (no VIP/rakeback perks) · 🟡 Hourly airdrop (sybil-farmable, in-memory) · ❌ Airdrop sybil resistance.

**Affiliate** — 🔴 Referral attribution (stub) · ❌ Self-referral/wash-trade guards.

**Social/Chat** — 🟡 Realtime chat (in-memory limiter) · 🟡 Moderation (delete unreachable from socket) · 🟡 Tipping/rain/emotes (none).

**Leaderboards** — ✅ All-time boards · ❌ Windowed + caching (snapshot table unused) · ❌ Races/tournaments.

**Account/Profile** — ✅ Profile stats + tx history · 🟡 Settings (socials are free-text, no OAuth) · ❌ Session lifecycle · 🟡 Banned-user enforcement at auth.

**Admin/Ops** — ✅ Stats/ban/unban · 🟡 RolesGuard + audit log (inline lookups, no trail) · ❌ Game-config/RTP/limits console · ❌ BullMQ worker.

**Compliance/Legal** — ❌ KYC · ❌ Geofencing · ❌ Age gate · ❌ Responsible gambling · 🟡 Legal pages (thin, unversioned) · 🔴 Licensing claim accuracy · ❌ Cookie consent.

**Infra/Scaling** — ❌ Horizontal scaling/HA · 🟡 Settlement atomicity · ❌ Balance debit atomicity · ❌ Crash recovery · 🔴 Rate limiting (inert) · ❌ Ledger reconciliation/double-entry · ❌ Migration-on-deploy · ❌ Observability · ❌ k8s/Helm · 🟡 CI/CD coverage · 🟡 Secrets hygiene · 🟡 Health readiness · ❌ Backups/PITR/DR.

**Web/UX** — ✅ Full routed surface · ✅ Mobile + realtime · 🔴 On-chain settlement messaging accuracy · 🔴 Devnet/mainnet config · ❌ Error/loading/not-found boundaries + toasts · 🟡 SEO/OG/i18n/a11y.

> Legend: ✅ done · 🟡 partial · 🔴 stub (looks done, isn't) · ❌ missing.

---

## 8. Roadmap — next phases (G → M)

Continues from completed on-chain Phases A–F and UI Phases FAZ 1–11. Ordered by dependency; each phase retires a class of risk that the next depends on.

### Phase G — Ledger integrity & money-safety foundation (off-chain hardening) — **L**
Make the play-money ledger provably correct under concurrency and partial failure, so it can later mirror on-chain custody. Touches no real money; fixes the bugs that would be fatal once value flows.
- Wrap **every** settlement in a single `prisma.$transaction` (Serializable/RepeatableRead); retry-on-conflict + dead-letter instead of swallow-and-log.
- Atomic conditional debits (`updateMany WHERE balance >= amount`); DB `CHECK(playBalanceLamports >= 0)` and on `scadiumBalance`.
- Idempotency keys on bet/join/enter/buy + reward/airdrop claims; fix the negative-tip exploit and coinflip `biggestWin` nested-read race; unique `(roundId,userId)` on jackpot entry.
- Append-only **double-entry `BalanceLedger`** (`userId, delta, reason, refType, refId, balanceAfter`) written in the same tx; balances become a re-derivable projection.
- Reconciliation job (recompute `totalWagered/Won/Lost/biggestWin` from `Bet`+`BalanceLedger`, flag drift) + admin audit-log table.
- Concurrency integration suite proving no double-spend / double-settle / negative balance / aggregate drift under induced mid-settle failures.

### Phase H — Stateless API, Redis-backed state & the BullMQ worker — **XL**
Eliminate the single-instance trap so the API runs ≥2 replicas and survives restarts. Makes "crash mid-round" recoverable. *Depends on G.*
- Stand up the promised **`apps/worker`** (BullMQ over the already-provisioned Redis): airdrop distribution, leaderboard snapshots, buy-and-burn, reconciliation — idempotent, period-locked jobs.
- Move SIWS nonces + chat rate-limit windows to Redis (or the dead `AuthNonce` table); delete in-memory paths.
- Redis-backed shared live-round state + single-leader election so N replicas run **one** game loop; persist enough to rehydrate.
- Crash/round recovery on boot: scan DB+Redis for `waiting`/`running` rounds, resume or force-settle/refund with ledger entries; persist cashouts at cashout time.
- `/health/live` vs `/health/ready` (DB + Redis probes).
- Run-on-deploy migrations (`prisma migrate deploy` in init container/entrypoint).

### Phase I — Trustless randomness & true provable fairness — **L**
Close the cardinal hole: make randomness genuinely unpredictable to the operator before real money rides on it. *Best after H so VRF callbacks run as durable jobs.*
- Player-controlled client seed: `Seed.userId`, set/rotate-client-seed endpoint, pre-committed next-server-seed hash; all games derive from (rotating serverSeed, player clientSeed, monotonic nonce).
- Pin lottery target slot **at commit** (store in the `Draw` account); remove/mark the synthetic off-chain "slot hash" as non-fair.
- Evaluate/integrate **Switchboard or ORAO VRF** (or slot-pinned SlotHashes) for on-chain game entropy; design the commit→VRF→settle flow.
- Full-hand blackjack verifiability (per-bet deck-index/seat/deal-order in `Bet.resultJson` + multi-seat verifier); daily case → HMAC fair engine.
- Cross-impl parity (Node/browser/Rust) as a real CI test; fix jackpot modulo-bias/BigInt precision.

### Phase J — Anchor build/deploy/test + escrow vault wired to spendable balance (devnet) — **XL**
Turn the decorative chain into a deployed, reconciled custody system on **devnet**, and build the missing bridge. First time real-value semantics exist end-to-end. *Depends on G+H+I.*
- `anchor build` + committed IDL + deploy pipeline; fix setup scripts importing non-existent `../target/idl/*.json`; rewrite stale lottery tests (`reveal_draw` signature mismatch) so CI exercises the **current** programs.
- **Vault↔balance bridge**: deposit credits a custody-backed spendable balance; winnings sweep back so the user can withdraw real SOL.
- Make `settle_bet` **authoritative & reconciled**: stop emitting cosmetic zero-lamport receipts; verify tx success before crediting the mirror ledger; reconcile emitted == ledger == on-chain movement.
- Swap hardening: `MINIMUM_LIQUIDITY` dead-shares lock, `checked_` arithmetic, min-out; buy-and-burn slippage protection.
- Real funded USDT treasury with a solvency guard (prizes bounded by reserves; cap simultaneous grand winners; retry/reconcile failed payouts).
- House-bankroll/hot-wallet risk model (rent-floor handling, per-round max exposure, documented worst-case bankroll).

### Phase K — Auth, session, secrets & API security hardening — **L**
Harden identity/ops security to a real-funds standard. *Depends on H; parallel with I/J.*
- Register `ThrottlerGuard` as `APP_GUARD` + per-route limits (Redis-backed).
- Session lifecycle on the existing `Session` model: refresh tokens, rotation, `/auth/refresh`, revocation/blacklist, logout-everywhere; validate `typ` claim.
- Fail-closed secrets (assert `JWT_SECRET` at boot, remove fallback); cosigner key → KMS/HSM/Vault with rotation; fix `.env.example` doc drift.
- SIWS hardening: bind domain/URI/chainId/statement (anti cross-env replay); banned-user check at auth + wallet-link; atomic set-primary-wallet.
- Observability: wire `nestjs-pino` (JSON + request-id), Sentry, Prometheus/OTel; gate Swagger to non-prod/auth.
- CI security gates: `pnpm audit`/Dependabot, secret scan, SAST, container scan, Anchor/Rust + API e2e + money-flow tests.

### Phase L — Compliance, KYC/AML, geofencing & responsible gambling — **XL**
The legal layer a real-money operator must have; stop shipping false claims. Hard regulatory gate. *Depends on K; parallel to J.*
- Remove/condition false marketing ("Licensed & regulated", "settled on-chain") behind real state/licensing.
- Geo-IP geoblocking + VPN/proxy detection enforced at API/edge.
- 18+ age gate; real KYC flow (Sumsub/Onfido) gating deposits/withdrawals; sanctions/PEP screening.
- Responsible-gambling: deposit/loss/wager limits, cooling-off, working self-exclusion.
- Versioned dated legal pages + acceptance gate + cookie consent; affiliate/airdrop sybil + self-referral controls; airdrop sybil resistance tied to KYC.
- **Licensing (external/business):** obtain the actual gaming license for target jurisdiction(s).

### Phase M — Mainnet readiness: audits, infra, DR & staged rollout — **XL**
Take the real-value system from devnet to an audited, observable, recoverable mainnet deploy, proven under load with bounded funds. *Depends on G–L.*
- Independent third-party **audit** of all 3 Anchor programs + full-system pentest; remediate; publish reports.
- Production infra: **k8s/Helm** (none exist) for API + worker + Redis + Postgres HA; Postgres backups/PITR + DR runbook; staging mirror.
- Mainnet program deploy with upgrade-authority **multisig**; flip all devnet RPC/cluster/Solscan links to mainnet behind config.
- Bankroll & treasury ops: funded bankroll sized to worst-case, solvency monitoring/alerts, cold/hot split, key-ceremony/rotation, incident runbooks.
- Load & chaos testing (settlement atomicity, balance races, kill-9 mid-round, VRF callback failure); soak test.
- Staged rollout: closed beta with deposit caps + per-user limits; real-money kill-switch (`set_paused` already exists); gradual increases gated on clean reconciliation + audit sign-off.

---

## 9. Real-money gating checklist (do NOT enable real funds until all green)

- [ ] **Ledger integrity** — every settlement in one DB tx; atomic conditional debits + `CHECK(balance>=0)`; reconciliation proves aggregates == ledger == on-chain with **zero drift** over a sustained period. *(G/J)*
- [ ] **No balance exploits** — negative-tip and any mint vector closed; idempotency keys prevent double-spend/settle; concurrency tests pass under load. *(G)*
- [ ] **Restart safety** — kill-9 mid-round strands **zero** bets (all settled/refunded with ledger entries); no round stuck `running`. Chaos-verified. *(H)*
- [ ] **Horizontal scale proven** — ≥2 replicas run exactly one game loop each; SIWS works across pods; airdrop/leaderboard/burn are idempotent worker jobs. *(H)*
- [ ] **Trustless randomness** — players control client seed with pre-committed rotating server hashes; operator cannot grind; lottery slot pinned (or VRF); blackjack fully verifiable; daily case fair. *(I)*
- [ ] **Authoritative on-chain settlement** — `settle_bet` actually moves value; API verifies tx success before crediting; no cosmetic zero-lamport receipts. *(J)*
- [ ] **Custody bridge real** — deposited SOL is spendable; winnings withdrawable; spendable balance provably backed by vault custody. *(J)*
- [ ] **Programs built, tested, audited** — `anchor build`/IDL/tests in CI exercise current programs; third-party audit complete + remediated; swap has min-liquidity lock + checked math. *(J/M)*
- [ ] **Treasury solvency** — funded bankroll covers worst-case; lottery prizes bounded by reserves; failed payouts retry/reconcile with no silent loss. *(J)*
- [ ] **Security hardened** — `JWT_SECRET` fails closed; rate limiting enforced; sessions revocable; cosigner key in KMS/HSM; SIWS domain/chainId-bound. *(K)*
- [ ] **Compliance live** — valid license obtained; geo-block, age gate, KYC/AML, self-exclusion/limits enforced in code (✅ age gate server-enforced at the wager/deposit gate when `REAL_MONEY_ENABLED`, #146; ✅ geo fails closed on unverifiable region + trusted-proxy header trust + live VPN provider + boot-required `GEO_IP_SALT`, #149); all false marketing removed/made true. *(L)*
- [ ] **Production ops** — Helm/k8s HA; Postgres PITR + tested DR; observability live; mainnet config (no devnet links); global pause/kill-switch; staged closed-beta with deposit caps. *(M)*

---

## 10. Production-readiness scorecard

| Domain | Pass | Partial | Fail |
|---|---|---|---|
| **Security** | — | input-validation, SIWS binding | JWT-secret, sessions, rate-limit, cosigner custody, Swagger gating |
| **Money/ledger** | BigInt types | idempotency | atomic settle, debit race, balance-mint, reconciliation, real custody |
| **Fairness** | HMAC primitive, lottery 3-way | slot-pin, full-hand verify | player seed, daily-case fairness |
| **Scaling/HA** | — | — | stateless API, crash-recovery, BullMQ worker, Redis store |
| **Observability** | — | health probes | structured logs, error tracking/metrics, audit trail |
| **Compliance/legal** | — | — | KYC, geo, age gate, responsible-gambling, licensing accuracy |
| **DevOps/release** | migrations sequenced, containerization | CI coverage | migrate-on-deploy, Anchor build/deploy, k8s/Helm, hardened prod config |

**Bottom line:** the fastest, safest near-term work is **Phase G** — it's pure correctness on code that already exists, unlocks everything downstream, and closes the two casino-fatal bugs (non-atomic settlement, negative-tip mint) that are exploitable *today even in play-money*. Pair it with the trivial-but-high-value quick wins (enforce throttling, fix JWT fallback, correct false copy) for an immediate hardening pass.
