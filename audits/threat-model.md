# Scadium — Threat Model (#51)

Pre-audit threat model for the auditor/pentester. Distilled from `ANALYSIS.md`
§4 (risk register) / §5 (per-subsystem), updated for the Phase K–M hardening
landed since. The casino's trust proposition is "non-custodial, every payout
verifiable on-chain" — so the assets are **player funds** and the integrity of
**settlement randomness**.

## Assets

| Asset | Where | Worst case if compromised |
|---|---|---|
| Player vault funds (SOL) | `scadium_vault` user-vault PDAs | Theft / unauthorized withdrawal |
| House bankroll | `scadium_vault` house_vault PDA | Drain → insolvency, stranded payouts |
| $SCAD treasury / pool | `scadium_swap`, `scadium_lottery` | Mint/drain, price manipulation |
| Spendable balance ledger | Postgres `User.playBalanceLamports` + `Bet`/`BalanceLedger` | Double-spend, balance inflation |
| Cosigner hot key | custody provider (#36) | Forge settlements / treasury moves |
| Result randomness | server seed + clientSeed + SlotHashes (ADR 0002) | Operator grind → rigged outcomes |
| Auth (SIWS/JWT) | `apps/api/src/auth` | Account takeover, admin forgery |

## Trust boundaries

1. **Browser ↔ API** — untrusted client. All money mutations are server-authoritative;
   the client only *requests*. SIWS proves wallet ownership; JWT carries the session.
2. **API ↔ chain** — the cosigner signs only what the programs constrain. The program
   is the final arbiter of fund movement (vault PDA, rent floor, owner-only withdraw).
3. **API ↔ Postgres** — the ledger is the off-chain source of truth; the on-chain
   settle is reconciled against it (Phase J), credit only after a verified on-chain leg.
4. **Edge/proxy ↔ origin** — geo/IP headers are only trusted from a proxy presenting
   `GEO_PROXY_SECRET` (#149); direct-to-origin callers are treated as unknown-region.

## Attack surface & abuse cases (for the auditor to exercise)

### On-chain (programs)
- **A1 settle_bet conservation** — can a crafted settle move more out of house_vault
  than the bet's net, or emit a receipt for value it didn't move? Current code reverts
  on `InsufficientFunds` (no clamp); confirm conservation holds end-to-end once Phase J
  wires real value (`lib.rs` settle_bet, both branches).
- **A2 withdraw authorization** — can anyone but the vault owner withdraw? PDA seeds /
  signer checks.
- **A3 cosigner authority** — does `NotCosigner` reject a stale/rotated key? (#36 rotation.)
- **A4 swap invariant** — drain via rounding, missing `MINIMUM_LIQUIDITY` lock, or
  unchecked arithmetic; buy-and-burn `min_out` slippage.
- **A5 lottery entropy** — can a slot leader or the operator grind/withhold to bias the
  draw? Double-pay via the Payout PDA. Prize solvency vs treasury.
- **A6 set_paused** — only admin authority can pause; pause actually blocks settles.

### Off-chain (API / pentest)
- **B1 SIWS replay / domain binding** — reuse a signature across domain/cluster; nonce
  reuse; message-string mismatch between display and verify.
- **B2 JWT** — forged token (secret fallback — fixed #33), missing `typ`, no revocation;
  privilege escalation to admin.
- **B3 balance integrity** — double-spend under concurrency, negative-amount vectors
  (airdrop tip, #G), idempotency-key bypass, debit/credit non-atomicity.
- **B4 deposit/withdraw bridge** — credit the mirror off an unverified/forged tx; replay
  a deposit signature; vault-drift.
- **B5 solvency** — force a payout that exceeds bankroll (now refused pre-emptively, #54)
  or strands funds.
- **B6 compliance bypass** — wager/deposit while paused (#56), under-age (#146), from a
  blocked region/VPN (#149), or un-KYC'd (#45) via direct API calls.
- **B7 rate-limit / DoS** — bet-flood, auth-flood; per-IP throttle correctness behind a
  proxy.
- **B8 secret handling** — cosigner key exposure (file vs KMS, #36), JWT secret, Helm
  chart secret posture (#52).

## Already-mitigated (verify the mitigation, don't re-find)

JWT fail-closed + rotation (#33), atomic balance debits + idempotency (Phase G),
geo/age/pause/KYC/RG gates (#43/#146/#56/#45/#46), cosigner fail-closed-in-prod +
rotation (#36), pre-payout solvency guard (#54), SlotHashes entropy for lottery
(+ crash derivation, ADR 0002). These are the **expected-secure** controls; the audit
confirms they hold rather than assuming they don't.

## Residual / accepted (document, not necessarily fix)

- Single-slot-leader grind on SlotHashes entropy (ADR 0002) — bounded; VRF upgrade #102.
- In-process background loops are leader-elected, not yet a separate worker shard.
- The on-chain layer is decorative pre-Phase-J — **the audit is meaningful only after
  Phase J wires real value**; this is the gating dependency on #51.
