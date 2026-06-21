# SCAD Vault — on-chain bridge & deploy runbook (Faz 2)

Status: **code-complete, undeployed.** The term-vault instructions live in
`programs/scadium_vault` (V9); the server-side bridge (V10) is wired and
chain-gated. Everything below activates only once the program is deployed and
`VAULT_PROGRAM_ID` + a cosigner are configured — until then the off-chain ledger
(Postgres) is the source of truth and every chain call no-ops (`enabled=false`).

## Trust model (who signs what)

| Action | Signer | Server-driveable? |
|---|---|---|
| `init_vault_pool` | house authority | yes (admin/ops) |
| `vault_deposit` | **the user's wallet** | **no** — built client-side; the server never signs a user deposit |
| `vault_withdraw` | **the user's wallet** | **no** — client-side |
| `vault_accrue` | cosigner (hot key) | yes — `ChainService.vaultAccrue`, mirrored by `VaultAccrualService` |

Because deposit/withdraw are user-signed, the on-chain custody flow is a
**client-wallet** flow (the web app builds + submits the tx with the connected
wallet). The server's bridge only mirrors the cosigner-signed **yield accrual**
on-chain and **reads** pool state for reconciliation.

## Server bridge (V10)

- `ChainService.vaultAccrue({ termDays, amountScadBase })` — cosigner-signed
  on-chain accrual; returns the tx sig or `null` (disabled/error).
- `ChainService.readVaultPoolOnChain(termDays)` — decodes the on-chain
  `VaultPool` totals for reconciliation.
- `VaultAccrualService` calls `vaultAccrue` best-effort after each off-chain
  accrual round when `enabled`, stamping the `VaultEvent.txSignature`.
- `ReconciliationService.vaultDrift()` — flags pools whose off-chain
  `totalAssets` diverges from on-chain (flag-only; no-op while disabled).

## Deploy steps (when unblocked)

1. **Fund a deployer keypair** on the target cluster.
   > ⚠️ **Known blocker:** devnet SOL funding is currently unsolved on this
   > workstation (faucet/RPC limits). Resolve funding first (faucet, a funded
   > keypair, or a paid RPC) — this is the single gate on devnet deploy.
2. `anchor build` (already green in CI; IDL/types committed).
3. `anchor deploy --provider.cluster devnet` (or mainnet later, behind the
   audit + multisig + KMS gate from `ANALYSIS.md` Phase M).
4. `init_house` (if not already), then `init_vault_pool` for each term
   (30/90/180/365) with the weights from `VAULT.TERMS`.
5. Set env: `VAULT_PROGRAM_ID`, `SCAD_MINT`, and the cosigner provider → the API
   flips `ChainService.enabled = true` on boot.
6. Mint/seed the house treasury `$SCAD` ATA so `vault_accrue` can fund yield.
7. Run `ReconciliationService.vaultDrift()` to confirm off-chain ↔ on-chain
   agreement before announcing custody.

## Notes

- Off-chain remains authoritative; on-chain is a verifiable mirror. A drift is an
  alert, not an auto-mutation (same discipline as `fundedDrift` / receipt drift).
- The new instructions' **localnet mocha** integration is added alongside the
  first real deploy work; the program's share/index math is already unit-tested
  in Rust (`cargo test --workspace --lib`).
