# Scadium — Audit & Pentest Scope (#51)

> Prep package for the external program audit + full-system pentest. This is the
> **pre-engagement** deliverable — it does NOT replace the audit. Vendor selection,
> the engagement, finding remediation, and report publishing are tracked on #51.

**Status:** prep package assembled · vendor engagement PENDING (external).

## Audited revision

| Item | Value |
|---|---|
| Repo | `mcftc/scadium` |
| Prep commit SHA | `4c2c8b3b0f6742222ab011579499e02455338772` |
| Build | `anchor build` (reproducible — toolchain pinned in `Anchor.toml`) |
| Anchor / Solana | anchor-lang 1.0, agave/solana 4.0.1 (see CI `anchor-tests`) |

> **Re-pin before engagement.** Programs are still pre-Phase-J (decorative on-chain
> layer). The auditor must review the **deployed, balance-wired** programs — re-pin
> the SHA to the Phase-J devnet release. Auditing cosmetic code is out of scope per
> #51's dependency on Phase J.

## In scope — Anchor programs

| Program | Program ID (devnet `declare_id!`) | LOC | Surface |
|---|---|---|---|
| `scadium_vault` | `DSQJ8FX8JGhB2nKPGVM2ptWZydskNmp8629C8HXTvrqr` | 483 | custody, deposit/withdraw, `settle_bet`, `claim_reward`, `set_paused` |
| `scadium_swap` | `9Fog7cFRQiPfszYu1ioFdqQDwmmTd6SZpkyb8hyo13dU` | 542 | CPMM pool, add/remove liquidity, swap, buy-and-burn |
| `scadium_lottery` | `3HHxLKiAW4JhSHaPSKpjCqCxpQgPfTd8pP6tzL8ZAVk5` | 839 | commit-reveal + SlotHashes draw, ticket buy, prize payout, burn/inject |

Priority focus (from `ANALYSIS.md` §3/§5):
- `vault::settle_bet` (`programs/scadium_vault/src/lib.rs`) — the net is moved IN FULL or
  the tx **reverts** (`require!(available >= net, VaultError::InsufficientFunds)`, no clamp),
  so a receipt can never overstate the lamports actually moved. Confirm this holds under
  the authoritative Phase-J wiring and that house↔user lamport conservation is exact
  (rent-floor handling, both win and loss branches).
- `vault::withdraw` — only the owner's wallet signature can move vault funds.
- `swap` — CPMM invariant, `MINIMUM_LIQUIDITY` dead-shares lock, checked arithmetic,
  buy-and-burn `min_out` slippage.
- `lottery` — slot-pin / reveal cannot be ground; prize solvency; double-pay backstop
  (Payout PDA keyed per (draw, winner)).

## In scope — API / off-chain (pentest)

- **Auth**: SIWS (ed25519 verify, canonical message re-derivation, nonce one-time use),
  JWT (fail-closed secret, refresh rotation, `typ` claim), session lifecycle.
- **Settlement & treasury**: `apps/api/src/solana/chain.service.ts` (hand-rolled IDL-free
  Anchor encoding for `settleBet`/`claimReward`/lottery), the cosigner custody provider
  (`cosigner-key.provider.ts` — fail-closed in prod, rotation), the pre-payout solvency
  guard (`treasury-guard.ts`), reconciliation/drift.
- **Money path**: balance debits (atomicity, `applyBalanceDelta`, no-double-spend),
  idempotency keys, the unified `Bet` ledger, vault deposit/withdraw bridge.
- **Compliance gates** (this milestone): global pause (#56), age gate (#146), geo/VPN
  fail-closed + trusted-proxy (#149), KYC (#45), responsible-gambling limits (#46).
- **Infra**: rate-limiting, secret handling, the Helm chart's secret/RBAC posture (#52).

## Out of scope

- Third-party dependencies' own code (flagged via `cargo audit` / `pnpm audit` in CI).
- The play-money demo's economic balance (not a security boundary).
- Front-end visual/UX (covered by the compliance copy gating, #42/#142).

## Vendor engagement (to record here on engagement)

- Program auditor (OtterSec / Neodyme / Zellic class): _TBD_ — engagement ref: _TBD_.
- Pentest vendor (API/auth/settlement): _TBD_ — engagement ref: _TBD_.
- Audited commit (re-pinned, Phase-J): _TBD_.

## Process

1. Engage vendors against the re-pinned Phase-J revision.
2. File each finding as a GitHub issue: label `type:security` + the vendor severity
   (`severity:critical|high|medium|low`), linked to #51.
3. Remediate **all Critical/High** with a failing→passing regression test per finding
   (`tests/<program>.audit-<ID>.spec.ts` / `apps/api/test/audit-remediation.e2e-spec.ts`).
4. Fix-review pass; obtain final signed reports → commit under `audits/` → link from the
   whitepaper/fairness page.
5. The `audit-status` CI gate (`.github/workflows/ci.yml`) blocks while any open
   `type:security` + `severity:critical|high` issue exists in the Phase M milestone.

See [threat-model.md](./threat-model.md) for assets, trust boundaries, and abuse cases.
