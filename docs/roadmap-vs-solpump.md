# Scadium vs solpump.io — Gap Analysis & Roadmap

_Generated 2026-07-16 from a multi-angle research pass on solpump.io (bot-blocked direct fetch; sourced from its own game/FAQ/fairness pages + third-party reviews) cross-referenced with a code-grounded inventory of Scadium. Rolemodel: solpump.io._

## Where Scadium stands

Scadium is already ahead of solpump.io on breadth and mechanics: 12 fully playable originals vs solpump's 5 (Keno is the only solpump game Scadium lacks), a working Proof-of-Play mining + staking-dividend + term-vault token economy that exceeds solpump's merely-teased staking, an hourly chat-gated airdrop that clones solpump's signature rain loop, and a responsible-gambling/compliance stack solpump doesn't have at all. Where Scadium is decisively behind is solpump's core identity — on-chain, wallet-native money: the Anchor programs, deposit/withdraw UX, and claim lifecycle are code-complete but dormant (chain disabled, programs undeployed, settleBet has zero callers), so every reward that should deliver value (daily case, cashback, $SCAD claims) currently pays nothing real. The second tier of gaps is cheap, unblocked product polish that solpump-class sites treat as table stakes: no global live-bet feed, no published per-game RTP, no daily/weekly leaderboards or races, auto-bet only on crash, and — a genuine money bug — affiliate commission silently accrues on only 2 of 12 games. The strategy is therefore: spend the Railway-blocked waiting period shipping the unblocked retention/trust surface and closing the open Tier 2 money-integrity blockers, deploy to devnet now (deployer SOL is faucet-cheap and doesn't need Railway) to light up the entire dormant chain layer in staging, and hold mainnet/real-money for the genuinely blocked external track (Railway plan, licence, third-party audit, real KYC). Executed in that order, Scadium reaches feature superiority over solpump on everything except live on-chain settlement within the unblocked work alone, and the blocked items become a short, well-defined cutover list rather than an open-ended roadmap.

## Gap matrix

| Dimension | vs solpump | Gap |
|---|---|---|
| Game portfolio breadth | **ahead** | 12 e2e-playable originals vs solpump's 5 (Crash/Coinflip/Jackpot/Blackjack/Keno). Only Keno is missing; solpump's thin catalog is its most-criticized weakness. |
| Provably-fair engine + verifier | **parity** | Same HMAC-SHA256 commit-reveal scheme, plus category-norm client seed/nonce/rotation solpump lacks; fairness verifier page with per-round deep links exists. Missing only SEO-friendly per-game /fairness/<game> landing pages. |
| On-chain bet settlement (solpump's core differentiator) | **missing** | Every bet on solpump is an individual Solana tx verifiable by signature. Scadium's settleBet is fully coded with reserve-floor + delta-verification but has ZERO game callers; even the 0-lamport recordBet receipt is inert (chain.enabled=false). All 12 games settle Postgres-only. |
| Non-custodial deposits/withdrawals | **behind** | User-signed vault-PDA deposit/withdraw with event-verified bridge is code-complete but dead-ends at 'On-chain vault is not enabled on this server yet' — programs undeployed, no VAULT_PROGRAM_ID/cosigner configured. Also no deposit/withdraw history endpoint or UI. |
| Token economy mechanics | **ahead** | Working hourly block mining (halving schedule), liquid staking with 12%-NGR USDS dividends, and 4-term ERC-4626-style vault — vs solpump's staking/governance being 'coming soon'. Buy-and-burn deliberately dropped in favor of dividends (conscious divergence; solpump burns 20% NGR daily). |
| Token value delivery (claims/redemption/dashboard) | **behind** | All redemption is chain-gated and dormant: wager/cashback/dividend claims throw 'disabled', daily case writes a no-value 'offchain' row, swap pool reads are off. solpump ships a live token dashboard + in-site buy/sell. Scadium has /token/stats but no realized value path. |
| Hourly airdrop / chat rain | **parity** | Same mechanic as solpump (≥0.001 SOL wagered + chat activity, hourly pool, tips), plus sybil filtering solpump doesn't document. Pays lamports, not $SCAD — the 10% community token allocation is display-only. |
| Referral/affiliate program | **behind** | Tiered commission + claim + sybil flagging exist, but creditReferral fires only from crash and coinflip — referred play on the other 10 games earns the referrer nothing, and there is no coverage guard to catch it (unlike proof-of-wager's coverage.spec). |
| Leaderboards, races, prizes | **behind** | Lifetime volume/profit boards only. Hourly snapshots are written but never read; no daily/weekly windows, no wager races, no rank-based prizes — solpump has a top-10 points leaderboard and announced daily SOL races; Stake-class peers run them daily. |
| Live-bet feed / social proof | **missing** | No sitewide all-bets/high-roller/big-win ticker anywhere; /platform/live returns aggregate counters only, and instant games broadcast no settlements. This is a category staple and solpump's on-chain-records trust story equivalent. |
| RTP / house-edge transparency | **behind** | Edges live in @scadium/shared constants but are not published on game pages. solpump markets its edge openly (1.9x coinflip, 95% RTP crash, 5% jackpot rake) — and its edge-vs-marketing discrepancy is a named trust failure to avoid. |
| Betting UX (auto-bet, history, hotkeys) | **behind** | Auto-bet + auto-cashout exist only for crash; dice/limbo/plinko/wheel have no auto-bet, no stop-win/loss engine, no per-game history panel (RecentRounds wired only into hilo/mines/tower despite the backend endpoint covering all games), no hotkeys. |
| Chat & community | **parity** | Persistent global chat with rate-limiting, level badges, wager gate matches solpump. No P2P tipping/rain (solpump lacks it too). Loose ends: moderation delete has no route, profanity filter is a 3-word stub, single room only. |
| Responsible gambling & compliance code | **ahead** | Full RG toolkit (self-exclusion, limits, age gate) with a source-scan coverage contract, always-on geoblocking, fail-closed real-money boot gate — solpump has essentially no RG tools. This is a differentiator once real money launches. |
| Licence, audits, trust artifacts | **missing** | No gaming licence (solpump: Anjouan ALSI-202410059-FI2 with corporate entity), no third-party contract audit (solpump claims CertiK), no public burn/reserve stats page. The env config and audit-prep package exist; the external engagements do not. |
| Production deployment & scaling | **behind** | Not hosted anywhere (Railway paid plan blocked); docker-compose.prod ships no worker container so background jobs would never run; API is effectively single-instance; public /metrics unlocked; KMS cosigner unimplemented (fails closed). |

## Do-first priorities

1. **[S] Wire affiliate commission into all 12 games + add a coverage guard spec**  
   A live money bug in the acquisition loop: referred play on 10 of 12 games (everything settled via instant-settle, stateful-round, blackjack/jackpot/lottery engines) earns referrers nothing. The fix pattern already exists — creditReferral runs inside settlement transactions in crash/coinflip, and proof-of-wager's coverage.spec.ts is the guard template to copy so it can never regress.
2. **[S] Publish per-game RTP/house-edge on game pages + per-game fairness landing pages**  
   Cheapest trust win available. solpump markets edge openly and its edge-vs-advertised discrepancy is a named trust failure; Scadium's edges already live in @scadium/shared constants and the verifier already exists — this is surfacing, plus SEO-friendly /fairness/<game> pages matching solpump's first-class fairness product surface.
3. **[S] Give daily case and cashback an off-chain value path (credit scadiumBalance directly)**  
   Today the daily case explicitly pays nothing ('offchain' demo rows) and cashback can never be realized — a retention feature that visibly pays zero is worse than none. $SCAD is already an off-chain ledger balance; crediting it via applyBalanceDelta with the existing RewardClaim trail makes the whole rewards hub real immediately, with the chain claim as the later withdrawal path.
4. **[M] Global live-bet / big-win feed (sitewide ticker + socket broadcast)**  
   The single biggest missing social-proof surface vs solpump and every category peer. Requires a cross-game settlement broadcast (instant games currently emit nothing) and a landing/header component; the unified Bet table already has everything needed.
5. **[M] Daily/weekly leaderboards + a daily race with prizes**  
   Snapshots are already written hourly and never read — pure waste. Windowed boards + a countdown race paying top-N from the airdrop-pool pattern matches solpump's announced daily race and Stake's table-stakes retention mechanic. Pairs with the live-bet feed for the retention story.
6. **[M] Auto-bet engine + RecentRounds history for dice/limbo/plinko/wheel**  
   Auto-bet with stop-on-win/loss is a category staple that exists only for crash; the four pure-instant games also lack the bet-history panel that hilo/mines/tower already embed (backend endpoint already supports it). One shared hook + panel closes both gaps across four games at once.
7. **[L] Close the Tier 2 money-integrity blockers (C4/H13 claim double-pay, H5/H5a forged events, H6–H8 lottery, H9 gate coupling, reserve ledger rows) and fix the audit-status gate ↔ BACKLOG mismatch**  
   These are the known open real-money cutover blockers in BACKLOG.md — pure unblocked code work that must land before any chain activation. The meta-bug matters too: the CI audit gate reads GitHub issue labels while findings now live only in BACKLOG.md, making the gate a silent permanent pass.
8. **[M] Regenerate program keypairs (H10), deploy all four programs to devnet, and activate the chain layer in staging** _(BLOCKED: partially — needs devnet deployer SOL (faucet) and a staging environment; not blocked on Railway or legal)_  
   Committed keypairs mean the declared program IDs are burned — regeneration is mandatory anyway. Devnet SOL is faucet-free, so this does NOT wait on Railway: deploying lights up the entire dormant layer (deposits/withdrawals, recordBet receipts stamping Bet.txSignature, $SCAD claims, lottery draws, swap reads) end-to-end for the first time and de-risks mainnet.
9. **[M] Implement the KMS cosigner provider**  
   cosigner-key.provider.ts fails closed in production by design — real-money signing is impossible until KmsCosignerProvider exists. It's ordinary unblocked code and a hard prerequisite for both the external audit scope and mainnet, so write it while waiting on the blocked items.
10. **[M] Production hosting: Railway deploy with API + worker + Redis + Postgres (and fix docker-compose.prod's missing worker)** _(BLOCKED: Railway paid plan (owner budget decision))_  
   Nothing is hosted; without the worker container, solvency, reconciliation, airdrops, and distributions silently never run in prod. This is the gate to any public play-money launch, which is itself the marketing/track-record precursor to real money.
11. **[L] External track: gaming licence (Anjouan/Curaçao), third-party program audit + pentest, real KYC provider (Sumsub/Onfido), AML monitoring** _(BLOCKED: legal counsel + budget; audit additionally blocked on program deployment and KMS cosigner)_  
   The fail-closed gates are built and waiting for exactly these inputs — solpump's own baseline is a registry-linked Anjouan licence and a claimed CertiK audit. Sequenced last because each depends on money/legal engagement and (for the audit) on deployed, balance-wired programs from the devnet/mainnet track.
12. **[M] Keno**  
   The one solpump game Scadium lacks (up to 4,115x, five risk modes). Fits the existing instant-settle architecture cleanly, but it's portfolio garnish — 12 games already beat 5, so it ranks below every trust/retention/money item.

## Now / Next / Later

### NOW — unblocked, high-impact
- ✅ **DONE** — Fix affiliate creditReferral coverage across all 12 games + add an affiliates coverage guard spec (money bug, S) — commits `5f438f2` + `d47d4f7`
- ✅ **DONE** — Publish RTP/house-edge on every game page (S) — `GAME_RTP` single-source map derived from `HOUSE_EDGE`, surfaced on all 12 games, `rtp.test.ts` guard (commit `fc094cc`). (Per-game `/fairness/<game>` landing pages deferred — the shared `/fairness` verifier is deep-linked from each game.)
- ✅ **DONE** — Add RecentRounds bet-history panel to dice/limbo/plinko/wheel (commit `1e948a1`)
- ✅ **DONE** — Global live-bet feed: `/live` socket firehose + `GET /live/bets` seed + `LiveBetTicker` in the app shell; all 12 games publish post-commit (fire-and-forget). `LiveModule`.
- Off-chain value fallback: daily case and cashback credit scadiumBalance via applyBalanceDelta so rewards pay something real today (S) — **owner tokenomics decision, see BACKLOG.md**
- Regenerate the burned committed program keypairs (H10) — mandatory before any deploy, do it now (S)
- Fix the audit-status CI gate ↔ BACKLOG.md process mismatch so security findings can actually trip the gate (S) — **owner CI-contract decision, see BACKLOG.md**

### NEXT
- ✅ **DONE** — Daily/weekly windowed leaderboards + a daily race with rank prizes and countdown (reads the hourly snapshots that were being written and never read; `RaceResult`-idempotent payout on the worker). `LiveModule`-adjacent retention surface. Commit in CHANGELOG.
- Close all Tier 2 money-integrity blockers: C4/H13 reward-claim double-pay + idempotency, H5/H5a program-id assertion on event verification, H6–H8 lottery on-chain holes, H9 real-money gate coupling to mainnet custody, reward reserve/restore ledger rows
- Devnet deploy of scadium_vault/swap/lottery/rng + activate ChainService in a staging env: exercise deposits/withdrawals, recordBet receipts, $SCAD/dividend claims, lottery commit-reveal end-to-end
- Auto-bet engine (N rounds, stop-on-win/loss, on-win multiply) shared across instant games
- Daily/weekly windowed leaderboards (read the snapshots already being written) + daily race with rank prizes and countdown
- Deposit/withdraw history endpoint + wallet transaction-history UI (VaultTransfer rows already exist)
- Implement KmsCosignerProvider (hard prerequisite for mainnet and for audit scope)
- Chat hardening: wire the moderation delete route, replace the 3-word profanity stub, add mute/timeout tooling
- Schedule the fundedDrift/chainDrift/vaultDrift monitors in the worker ahead of chain activation

### LATER (mostly blocked on Railway / legal / audit)
- Railway paid-plan production deploy: API + worker + Redis + Postgres, fix docker-compose.prod's missing worker container, lock public /metrics, resolve single-instance API scaling (H12/H19) — blocked on Railway budget
- External real-money track: gaming licence (Anjouan/Curaçao route like solpump's), third-party program audit + pentest engagement, real KYC provider integration (Sumsub/Onfido), sanctions screening + AML transaction monitoring — blocked on legal/budget
- Mainnet program deploy + wire settleBet into game settlement (or commit to the hybrid custody-with-instant-claim model), flip REAL_MONEY_ENABLED through the fail-closed gate
- Keno (closes the last game-portfolio gap vs solpump)
- VIP/rakeback tier track on top of existing levels; P2P tipping and chat rain (category norms solpump itself lacks)
- $SCAD community airdrop path (the 10% allocation currently display-only), token dashboard parity with solpump's /coin/dashboard, USDC/multi-asset deposits
