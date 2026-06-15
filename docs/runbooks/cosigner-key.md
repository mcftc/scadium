# Runbook — Cosigner key custody & rotation (#36)

The **cosigner** is the hot key that signs every privileged on-chain transaction:
`settle_bet`, `claim_reward`, lottery `commit_draw` / `reveal_draw` / `pay_prize`,
and the dev SCAD faucet. Compromise of this key = compromise of settlement and
treasury authority, so it must never sit as a plaintext file on a production host.

`ChainService` depends on a `CosignerKeyProvider` (`src/solana/cosigner-key.provider.ts`)
instead of reading the key itself. The provider is selected at boot
(`solana.module.ts` factory):

| Env | Provider | Behaviour |
|---|---|---|
| `COSIGNER_KMS_KEY_ID` set | managed (KMS/HSM/Vault) | **seam — not yet implemented**; today returns DISABLED (fail-safe) |
| `NODE_ENV=production`, no managed key | disabled | **fail-closed** — never loads a disk key; on-chain settlement stays off |
| non-production + `COSIGNER_KEYPAIR_PATH` | file (dev) | loads the plaintext JSON keypair from disk |
| nothing configured | disabled | play-money mode |

## Why production fails closed

A plaintext keypair on disk is exposed by any host compromise, file-read, or SSRF
bug. In production the factory refuses to load it — `ChainService.enabled` stays
`false` and privileged tx methods return `null` — until a managed provider signs
without exposing raw key bytes to the process. **Implement `KmsCosignerProvider`
(AWS KMS asymmetric ed25519, or Vault transit) before enabling real money.**

## Rotation (no redeploy)

The cosigner can be rotated without restarting the API:

1. Provision the new key (new KMS key version, or replace the dev keypair file).
2. `curl -fsS -X POST https://<api>/api/v1/admin/cosigner/reload -H "Authorization: Bearer $ADMIN_JWT"`
   → re-loads the key through the provider and re-derives `enabled`; returns the
   active cosigner public key.
3. Confirm the returned public key matches the new key, and that the program's
   on-chain authority has been updated to it (the program must accept the new
   cosigner before old in-flight settlements drain).

Sequencing for a real rotation: add the new cosigner as an authorized signer on
the program, deploy/point the API at it, `/admin/cosigner/reload`, drain/confirm,
then revoke the old key on-chain.

## Boot signal

- Enabled: `On-chain settlement enabled — program <id>, cosigner <pubkey> (<kind>)`.
- Fail-closed in prod: `No managed cosigner provider configured … refusing to load
  a plaintext keypair from disk in production. On-chain settlement DISABLED.`

`HOUSE_WALLET_SECRET_KEY` is **removed** — it was never read by any code and only
invited misconfiguration. The cosigner is configured via the vars above.
