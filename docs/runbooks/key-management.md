# Runbook — Cosigner key ceremony & rotation (#54)

Builds on the custody seam from #36 ([[cosigner-key]]). The cosigner signs every
privileged on-chain tx; this runbook covers generation, the cold/hot split, and
rotation cadence/drill.

## Key ceremony (generation)

Real money requires the cosigner private key to be generated and held in a
managed store — **never** as a plaintext file on an app host (the production
provider fails closed on a disk key; see [[cosigner-key]]).

1. Generate the cosigner key inside the KMS/HSM (AWS KMS asymmetric ed25519, or
   HashiCorp Vault transit) — the raw private key never leaves the boundary.
2. m-of-n ceremony for the **cold treasury / upgrade authority**: generate under
   a multisig (e.g. Squads) with quorum across separate operators and hardware.
   Record participants, device fingerprints, and the resulting addresses.
3. Register the cosigner public key as the program's authorized cosigner; register
   the multisig as the program upgrade authority (#53 deploy).
4. Configure the API: `COSIGNER_KMS_KEY_ID` (managed) in production; the dev file
   path is refused in production. (The managed signer impl is the open part of #36.)

## Cold / hot split

- **Hot** (`house_vault`): only an operational float — enough for expected payout
  throughput plus the reserve floor + buffer ([[bankroll-model]]). The hot cosigner
  can sign only what the program constrains (`settle_bet`, `claim_reward`, …).
- **Cold** (multisig treasury): the bulk of the bankroll. Tops up the hot vault
  when `scadium_house_vault_lamports` approaches the floor (incident #1 in
  [[incident-response]]). Top-up requires multisig quorum; never automate cold→hot
  with a single key.

## Rotation cadence

- Scheduled: rotate the cosigner key every 90 days.
- Immediate: on suspected compromise (incident #3 in [[incident-response]]).

## Rotation procedure (no redeploy)

1. Provision the new key (new KMS key version, or new keypair) and authorize it on
   the program as a cosigner **alongside** the old one.
2. `POST /api/v1/admin/cosigner/reload` (admin-gated, audit-logged) — re-loads the
   key through the provider and re-derives `enabled`; returns the active public key.
3. Confirm the returned public key is the new one and that new settlements sign
   with it; drain any in-flight work signed by the old key.
4. Revoke the old key's on-chain authority.

## Rotation drill

Run the drill on devnet before relying on it in prod: register a new cosigner,
reload, confirm a settle signs with the new key and the old key is rejected
(`NotCosigner`, `programs/scadium_vault/src/lib.rs`). A scripted drill
(`scripts/cosigner-rotate-drill.sh`) is **deferred** — it requires a funded devnet
vault + deployed program (Phase J), which aren't available yet; the manual steps
above are the interim procedure.
