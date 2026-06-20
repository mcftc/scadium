# ADR 0003 — Off-chain-first hybrid SCAD Engine & the on-chain boundary

**Status:** Accepted (2026-06-20) · Phase G/H (engine off-chain, shipped #204) → Phase J (on-chain custody/settlement boundary) · issues: #204 (implemented), #210 / #211 (future, external-gated), #229 (ledger gap)

## Context

The **SCAD Engine** is Scadium's bc.game-style loyalty/yield loop: a player **plays** any
game → **mines** `$SCAD` (proof-of-wager accrual proportional to wagered volume) → the
earned `$SCAD` is **staked** (locked) → stakers earn a pro-rata **USDS dividend** from a
slice of casino NGR each hour. Staking has an **auto-stake** mode (earned `$SCAD` is swept
into the locked stake automatically) and a **manual** stake/unstake path.

Before building the engine UX (#204) we had to decide **where the engine's accounting
lives**: on the Solana chain, or off-chain in Postgres. This is consequential because it
sets the trust model and the migration cost for the whole yield system.

Constraints that frame the decision:
- The casino currently runs on **play-money** (`User.playBalanceLamports`, Postgres). The
  on-chain programs (`scadium_vault`/`scadium_swap`/`scadium_lottery`) exist but are
  **decorative** — unbuilt/undeployed, vault never reconciled with the spendable balance
  (see `ANALYSIS.md`). Real money is gated on external resources not yet provisioned:
  mainnet deploy + multisig, a security audit (#51), VRF funding (#102), and a managed
  cosigner (KMS/HSM, gated by `COSIGNER_KMS_KEY_ID`).
- The crash engine ticks at **20 Hz** and settles continuously; coinflip/blackjack/jackpot
  settle per action. Per-bet on-chain writes would add SOL fees + multi-slot latency to a
  hot path.
- The codebase already has a robust **off-chain money spine**: every balance move goes
  through `applyBalanceDelta` (guarded `updateMany`), serializable settles
  (`withSerializable`), an append-only `BalanceLedger`, and a reconciliation service
  (`stakeLedgerDrift`, `usdsSolvency`, `reconcileAll`) that detects drift.
- bc.game itself — the reference product — runs its engine **off-chain**; the chain is the
  custody/withdrawal boundary, not the accounting layer.

## Options evaluated

| | A. Fully on-chain engine | **B. Off-chain-first hybrid** | C. Off-chain forever |
|---|---|---|---|
| Accounting (mine/stake/dividend) | On-chain program state | **Postgres ledger (`applyBalanceDelta`)** | Postgres ledger |
| Per-bet cost / latency | SOL fee + slots, on a 20 Hz loop | **~0 (DB tx)** | ~0 (DB tx) |
| Ships on today's stack | No — blocked on mainnet/audit/VRF/KMS | **Yes (devnet/play-money now)** | Yes |
| Matches bc.game + existing code | No | **Yes** | Partial |
| Custody / withdrawal trust | Trustless | **Operator-trusted until Phase J boundary** | Operator-trusted forever |
| Auditability | On-chain | **Reconciliation + ledger (off-chain), on-chain at boundary** | Reconciliation only |
| Migration to real money | N/A (already there, if it could ship) | **Boundary move, not a rewrite** | Requires a rewrite to go non-custodial |

## Decision

**Adopt the off-chain-first hybrid (Option B): the engine's *accounting* runs off-chain in
Postgres; the chain owns the *value boundary* — the `$SCAD` token, custody, the
claim/withdraw bridge, and (Phase J) authoritative settlement.**

Concretely, the responsibility split is:

| On-chain (the boundary) | Off-chain (the engine) |
|---|---|
| `$SCAD` SPL token + the SCAD/SOL pool & buy-and-burn | Proof-of-wager **mining** accrual (`scadiumBalance`) |
| Custody: deposits / withdrawals of real value | **Auto-stake** + manual stake/unstake (`scadiumStaked`, `stakeLockedUntil`) |
| `claim` / `claim_dividend` **withdraw** bridge (reservation lifecycle) | Hourly **USDS dividend** distribution (`DistributionRound`, pro-rata) |
| Phase J authoritative `settle_bet` (consumes pinned entropy, ADR 0002) | Balance integrity: `applyBalanceDelta` + `BalanceLedger` + reconciliation |

Rationale:
- **It ships now, unblocked.** The engine runs on the current devnet/play-money stack and
  delivers the full bc.game loop today; the chain pieces stay behind their existing flags
  until mainnet/audit/KMS exist.
- **It matches the reference product and the codebase.** bc.game's engine is off-chain;
  Scadium already has the ledger + reconciliation spine to make off-chain accounting
  auditable. We reuse it rather than re-implementing accounting in Rust.
- **Cost and latency.** Mining accrual and the auto-stake sweep are pure DB transactions —
  no per-bet SOL fee, no slot latency on the 20 Hz loop. The auto-stake sweep runs lazily
  on the `/staking/summary` read (which the `/engine` dashboard already polls), not on the
  settlement hot path.
- **On-chain is a boundary move, not a rebuild.** When custody/settlement go on-chain
  (Phase J), the off-chain ledger becomes a **mirror** that only credits after the on-chain
  settle confirms (the same pattern ADR 0002 defines for entropy). The accounting model and
  the derivation are unchanged; we move the *trust boundary*, we don't rewrite the engine.

Option A is rejected: it cannot ship on the current stack (every blocker above), adds
hot-path cost/latency, and duplicates accounting that already exists and is reconciled.
Option C is rejected: a non-custodial real-money casino must eventually put custody and
settlement on-chain — keeping the engine purely off-chain forever forecloses that.

## Consequences

- **Positive.** The engine epic (#204) shipped off-chain: real auto-stake (#206), the
  mined-`$SCAD`/earn-rate readout (#205), the `/engine` toggle + lock countdown (#207), and
  an honest dividend-claim UX that flags the on-chain withdraw as devnet/decorative when the
  chain is off (#208). All money moves go through `applyBalanceDelta`; `stakeLedgerDrift`
  stays zero; the auto-stake sweep is `withSerializable` and never perpetually extends the
  lock.
- **Trust assumption (explicit).** Until the Phase J custody/settlement boundary is live,
  stakers trust the operator's off-chain ledger for engine balances. This is honest and
  bounded — the same trust model as today's play-money casino — and is the property that the
  on-chain boundary removes for real money.
- **Known gap — the spendable `$SCAD` ledger (#229).** `ProofOfWagerService.accrue()`
  credits `scadiumBalance` with a raw increment (not `applyBalanceDelta`), so the spendable
  `scad` currency has no `BalanceLedger` credit rows. `stakeLedgerDrift` only covers
  `scad_staked`, so this is latent, but the spendable `scad` ledger is not yet reconcilable.
  Tracked in #229; route `accrue()` through `applyBalanceDelta` + add a reconcile arm.
- **Deferred to the on-chain boundary (external-gated).** On-chain provable fairness for the
  4 instant games (#210, builds on ADR 0002's entropy interface) and the on-chain custody +
  staking migration (#211, Phase J). Both need mainnet/VRF/funding and are *additions* on
  this boundary, not changes to the engine's accounting.
- The engine therefore has a single, documented migration path: **off-chain accounting today
  → on-chain mirror-and-settle at the Phase J boundary**, with the derivation and ledger
  model unchanged across the move.
