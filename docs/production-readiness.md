# Scadium — Production-Readiness Verdict

_Assessed 2026-07-16 on branch `fix/tier1-money-bugs` (33 commits ahead of `origin/main`, unpushed). Supersedes nothing — read alongside `docs/audit/phase-0-ground-truth.md` (the finding register), `BACKLOG.md` (tracked work), and `docs/deployment-architecture.md` (host decision)._

## TL;DR

| Launch mode | Verdict | Gating |
|---|---|---|
| **Play-money (public demo)** | ✅ **Ready to deploy** | Only a paid Railway plan + the DNS/edge cutover. No code blockers remain. |
| **Real-money** | ⛔ **Not ready** | The Tier-2 money-integrity blockers + the external legal/audit/KYC track. Do **not** flip `REAL_MONEY_ENABLED`. |

The play-money product is now feature-superior to solpump.io on everything except live on-chain settlement, and the exploitable play-money money bugs found in the Phase-0 audit are fixed and regression-tested. What stands between here and real money is a well-defined, mostly-unblocked code list plus genuinely-external engagements (licence, third-party audit, KYC vendor).

## What is production-ready now (play-money)

- **12 games, all settling correctly.** Every settlement writes the unified `Bet` row, moves balances only through `applyBalanceDelta` (append-only ledger), accrues Proof-of-Wager + affiliate commission, all inside a Serializable tx with a retry-safe claim gate.
- **Tier-1 money integrity (was exploitable) — fixed + tested:** blackjack rebet/stale-seat money-print (C1/C2), seed-rotation mid-round reveal (C3), coinflip cancel/join TOCTOU (H2), crash auto-cashout-below-bust (H3), blackjack betting-window restart confiscation (H1), hourly-settle-on-partial-data (H11), RG-limit bypass on coinflip/lottery (H20), affiliate commission payout path + all-12-games coverage (H18/#47), lottery play-money payout (H4). Each has a red→green regression test.
- **Trust surface (solpump parity):** published per-game RTP derived from the same `HOUSE_EDGE` the payout math uses (can't drift); sitewide live-bet feed across all 12 games; per-game recent-rounds history; product copy corrected (no false "Audited", VRF, or on-chain claims).
- **Ops:** graceful shutdown (SIGTERM drains loops/sockets); the worker ships on **both** deploy paths (Helm + compose, H19) so background money-jobs run; public `/metrics` has an optional token gate; per-IP throttling, structured logging with secret redaction, Prometheus, Sentry.
- **Compliance is fail-closed:** `assertRealMoneyReady` refuses to boot real-money mode unless licence + KYC + geoblocking + VPN detection are configured; geoblocking is always on.
- **Verification:** API 352 unit + integration (real Postgres/Redis) + full-app-boot; web typecheck/build/lint; worker build; fair 115 tests incl. Node⇄browser parity. All green locally. Two independent adversarial reviews of the live-feed change (money-path: APPROVE; resource-safety: 2 blockers found and fixed).

## What is NOT ready (real-money blockers)

**Tier 2 — code, mostly unblocked (must land before `REAL_MONEY_ENABLED`):**
- **C4 / H13** — reward/dividend claim can double-pay on a missed confirmation, and `period = Date.now()` defeats the idempotency key. Needs an on-chain existence probe + fixed time-bucket.
- **H5b** — the on-chain settlement bridge (`settleBet`) has **zero callers**; net play never sweeps between user/house vaults. Wire it + schedule the `funded/chain/vault` drift monitors.
- **H6–H8** — lottery on-chain holes: `/faucet` drains the cosigner; daily-draw slot expiry makes reveal impossible; restart settles an open draw early.
- **H9** — the real-money gate isn't coupled to mainnet-custody config (a non-prod `NODE_ENV` + mainnet ids could enable deposits with KYC failing open).
- **H10** — the program deploy keypairs are committed to git, so the declared program IDs are **burned**; regenerate fresh, uncommitted keypairs before any deploy.
- Reward reserve/restore writes no ledger row (false solvency drift once chain is on); the Swap module is unaudited.

**External track — genuinely blocked (budget/legal/time):**
- Gaming licence (solpump uses Anjouan); third-party program audit + pentest; real KYC/AML vendor (Sumsub/Onfido) wired end-to-end through the money path; the KMS cosigner (`KmsCosignerProvider`) is unimplemented and fails closed.

**Infrastructure:**
- Not hosted yet — Railway paid plan is the gate (project + Postgres + Redis are provisioned; compute needs the Hobby upgrade). API is effectively single-instance (run 1 replica; HA later).

## Recommended next actions (priority order)

1. **Deploy play-money to staging.** Upgrade the Railway plan, deploy api+worker+web+PG+Redis, cut Cloudflare DNS/edge over (proxied records, SSL Full-strict, WAF incl. a `/metrics` block rule, auth rate-limit, geo trusted-proxy transform). This is the only thing between the current branch and a live public demo.
2. **Push the branch + open a PR.** 33 commits are unpushed; CI (build/integration/anchor/secret-scan/trivy/helm/e2e) hasn't run on them. Owner decision — see "Open decisions".
3. **Devnet-deploy the 4 programs** (regenerate keypairs first — H10). Faucet SOL, **not** blocked on Railway or legal; lights up the entire dormant chain layer (deposits/withdrawals, recordBet receipts, $SCAD/dividend claims, lottery draws) end-to-end for the first time and de-risks mainnet.
4. **Close Tier-2 blockers** (C4/H13, H5b, H6–H10, reserve ledger rows) — the unblocked code prerequisites for any real-money cutover.
5. **Start the external track** (licence, audit, KYC vendor) — long lead times; begin in parallel.

## Open decisions for the owner (not resolved unilaterally)

- **Push/PR the branch** vs keep iterating locally. Recommended: push + PR so CI validates the 33 commits.
- **audit-status CI gate ↔ BACKLOG mismatch** — the gate reads GitHub-issue labels but findings now live in `BACKLOG.md`, so it's a silent permanent pass. Re-point it at a release/cutover branch, or resume filing cutover criticals as `phase:M` issues. (Details in `BACKLOG.md` → Process / CI gaps.)
- **Daily-case / cashback pay nothing in play-money mode** — a deliberate design choice today; whether play-money $SCAD rewards should credit balances (making the rewards hub pay real off-chain) is a tokenomics call.

## Bottom line

Ship the **play-money** product now (deploy + edge cutover are the only gaps). Hold **real money** for the Tier-2 code list + the external legal/audit/KYC engagements. Everything unblocked that moves Scadium toward that line — trust surface, ops hardening, money-bug fixes — is done and verified on this branch.
