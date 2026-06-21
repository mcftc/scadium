# SCAD Vault — Faz 3 (real DeFi yield) design & skeleton

Status: **design only — NOT implemented.** Faz 1 (off-chain $SCAD term vault +
house-revenue yield) and Faz 2 (on-chain program + bridge) are merged. Faz 3
adds **real external yield** (liquid staking + lending) and cannot be written
"decoratively": the CPIs target live mainnet protocol accounts. This document is
the blueprint to pick up once the preconditions below are met.

Tracks GitHub issues **#260 (V11)**, **#261 (V12)**, **#262 (V13)** under epic #249.

## 0. Hard preconditions (gates before ANY Faz 3 code ships)

1. **Program deployed** (devnet → mainnet). Blocked today on devnet-SOL funding —
   see `vault-onchain.md`. Mainnet additionally needs the audit + multisig + KMS
   gate (`ANALYSIS.md` Phase M).
2. **Security audit** of `scadium_vault` (Faz 2 instructions) AND the new Faz 3
   CPIs. Real yield = custody of user principal in third-party protocols.
3. **Legal opinion.** Real yield on user deposits is a financial-regulation
   surface (securities / e-money in many markets). The sweepstakes framing that
   covers gameplay does NOT automatically cover yield. Gate per target market.
4. **Multi-asset vault.** Faz 1/2 vaults are `$SCAD`-denominated; Faz 3 needs
   **SOL** and **USDC** pools (the `VaultAsset` enum already reserves `sol`/`usdc`).
   That is a prerequisite sub-task (V11a below), not a given.

> Until 1–4 hold, leave Faz 3 unimplemented. The Faz-1 house-revenue vault is the
> live product; Faz 3 is an upgrade, not a fix.

## 1. What changes vs Faz 1/2

| | Faz 1/2 (shipped) | Faz 3 (this doc) |
|---|---|---|
| Asset | `$SCAD` | + `SOL`, `USDC` pools |
| Yield source | house NGR slice (`VAULT.YIELD_NGR_BPS`) | + jitoSOL staking (~7%) + Kamino/MarginFi lending |
| Custody of principal | pool token account (idle) | **deployed** into external protocols (LST / lending) |
| Withdrawal | instant from pool balance | instant up to a **liquidity buffer**; large exits **unwind** a position |
| New risk | none external | protocol risk, unwind slippage, depeg, oracle |

Core idea: a pool keeps a **liquidity buffer** (`BUFFER_BPS`, e.g. 10–20% of
`totalAssets`) liquid for everyday withdrawals; the rest is **invested** (SOL →
jitoSOL, USDC → Kamino). Yield is **harvested** periodically and credited to the
pool index via the existing `apply_accrual` — so the share/index machinery and
the off-chain accounting from Faz 1 are REUSED unchanged; Faz 3 only changes
where the assets sit and adds harvest/invest/divest.

## 2. On-chain skeleton (`programs/scadium_vault`)

New `VaultPool` fields (additive; bump `SIZE` + a migration of pool state):

```rust
pub struct VaultPool {
    // ... existing (scad_mint→asset_mint, term_days, weight_bps,
    //     total_assets, total_shares, index_ray, bump) ...
    pub invested: u64,        // assets currently deployed in the strategy
    pub buffer_bps: u16,      // target liquid fraction (e.g. 1500 = 15%)
    pub strategy: Strategy,   // None | JitoStake | KaminoLend
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Strategy { None, JitoStake, KaminoLend }
```

New cosigner-signed instructions (the cosigner can only move pool↔strategy, never
to an arbitrary destination — same trust model as `vault_accrue`):

```rust
// Deploy idle assets above the buffer into the strategy (CPI to Jito/Kamino).
pub fn vault_invest(ctx: Context<VaultInvest>, amount: u64) -> Result<()>;
// Pull assets back from the strategy (for buffer top-up or a large withdrawal).
pub fn vault_divest(ctx: Context<VaultDivest>, amount: u64) -> Result<()>;
// Realise accrued external yield → credit the pool index (reuses apply_accrual).
pub fn vault_harvest(ctx: Context<VaultHarvest>) -> Result<()>;
```

`vault_withdraw` (V9) gains a buffer check: if `net > liquid_balance`, the tx
must be preceded by a `vault_divest` (or it reverts `InsufficientLiquidity`),
keeping withdraws atomic and never partially-settled.

CPI targets (remaining-accounts / specific contexts):
- **V11 — jitoSOL**: Sanctum/Jito SPL stake-pool `deposit_sol` / `withdraw_stake`
  (or liquid `withdraw_sol`). jitoSOL appreciates vs SOL → harvest = revalue.
- **V12 — Kamino**: `lend` / `withdraw` against a Kamino reserve (kUSDC), interest
  accrues in the cToken → harvest = revalue.

## 3. Off-chain skeleton (`apps/api`)

- `VaultStrategyService` (new): owns the invest/divest/harvest cadence per pool,
  worker-driven (queue `vault-strategy`, Redis-locked, idempotent per period),
  enforcing `buffer_bps`. Mirrors `VaultAccrualService`'s structure.
  - `rebalance(poolId)` — if `liquid > buffer target`, `vault_invest` the excess;
    if `liquid < buffer floor`, `vault_divest` to refill.
  - `harvest(poolId)` — read strategy position value, compute delta vs `invested`,
    credit the pool index via the existing accrual path (off-chain) + on-chain
    `vault_harvest` when live.
- `ChainService`: `vaultInvest` / `vaultDivest` / `vaultHarvest` / `readStrategyValue`
  — all cosigner-gated, null when disabled (mirror `vaultAccrue`).
- `ReconciliationService.vaultStrategyDrift()` — assert
  `pool.total_assets ≈ liquid_balance + strategy_value` (flag-only), extending
  `vaultDrift`. Add an **unwind-shortfall** alert (strategy can't cover a queued
  withdrawal).
- New shared constants in `VAULT`: `BUFFER_BPS`, `HARVEST_INTERVAL_MS`,
  `MAX_UNWIND_SLIPPAGE_BPS`, per-strategy caps.

## 4. Task breakdown

### V11 — Katman-1 liquid staking (jitoSOL) · #260 · P2
- **V11a (prereq):** multi-asset pools — `init_vault_pool` accepts SOL/USDC;
  off-chain `VaultPool.asset` + UI pool grouping by asset; share math is
  asset-agnostic already.
- SOL pool + Jito/Sanctum stake-pool CPI (`vault_invest`→deposit_sol,
  `vault_divest`→withdraw, `vault_harvest`→revalue jitoSOL).
- Liquidity buffer enforcement in `vault_withdraw`.
- **Acceptance:** deposit SOL → invested above buffer; harvest raises index;
  withdrawal within buffer is instant, above buffer divests first; anchor mocha
  on localnet with a mocked stake-pool (or devnet jito); `vaultStrategyDrift()=0`.

### V12 — Katman-2 lending (Kamino/MarginFi) · #261 · P2
- USDC pool + Kamino reserve `lend`/`withdraw` CPI; interest harvest → index.
- **Unwind management:** large withdrawal pulls from the reserve within
  `MAX_UNWIND_SLIPPAGE_BPS`; if the reserve is illiquid, queue + alert (never
  settle a partial).
- **Acceptance:** lend/withdraw round-trips; interest accrues to index;
  unwind-shortfall path flags and never over-pays; reconciliation drift 0.

### V13 — Tiered APR + risk panel · #262 · P3
- SCAD-held multiplier: holding/​staking `$SCAD` raises a user's effective APR
  (boost applied at harvest distribution, weighted by a `boostBps`). Drives token
  demand.
- `/vault` risk panel: per-pool strategy, deployed %, buffer, protocol, live APR,
  and a plain-language risk disclosure.
- **Acceptance:** boosted users verifiably earn more per share; risk panel
  renders strategy + buffer + protocol; Playwright render smoke.

## 5. Risks & mitigations

- **Regulation:** real yield ⇒ securities/e-money surface. Mitigate: legal
  opinion per market; consider gating Faz 3 to jurisdictions where it's clean;
  keep Faz-1 (house-revenue) as the default everywhere.
- **Liquidity / unwind:** deployed assets aren't instantly withdrawable. Mitigate:
  buffer (`BUFFER_BPS`), slippage cap, queue-and-alert for shortfalls, never
  partial-settle.
- **Protocol risk:** Jito/Kamino exploit or depeg. Mitigate: per-strategy caps,
  audited integrations only, a global pause (`House.paused` already gates accrue),
  monitor `vaultStrategyDrift`.
- **Index correctness:** harvest must revalue from on-chain truth (LST/cToken
  exchange rate), not a guess. Mitigate: read strategy value on-chain in
  `vault_harvest`; reconcile off-chain vs on-chain each round.

## 6. Sequencing

Deploy + audit + legal (gates) → **V11a multi-asset** → **V11 jitoSOL** →
**V12 Kamino** → **V13 tiered APR + risk panel**. Each behind `enabled` +
per-strategy caps; ship one strategy fully (incl. unwind + reconciliation) before
the next.

---

*Design only; supersede with implementation PRs once §0 preconditions hold. The
Faz-1/2 share/index core and off-chain-first hybrid are reused as-is — Faz 3 is
additive (where assets sit + harvest), not a rewrite.*
