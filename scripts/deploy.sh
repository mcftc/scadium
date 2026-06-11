#!/usr/bin/env bash
# Devnet deploy pipeline (#25): reproducible build + deploy for all three
# programs. The committed target/deploy/*-keypair.json pin the program ids to
# the declare_id!/Anchor.toml values, so re-deploys hit the same addresses.
#
# Usage:
#   ./scripts/deploy.sh            # build + deploy to devnet
#   CLUSTER=localnet ./scripts/deploy.sh   # against a local validator
#
# Requires: anchor CLI, solana CLI, a funded provider wallet
# (~/.config/solana/id.json — devnet faucet: `solana airdrop 2 --url devnet`).
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER="${CLUSTER:-devnet}"

echo "==> anchor build"
anchor build

for p in scadium_vault scadium_swap scadium_lottery; do
  test -f "target/idl/$p.json" || { echo "missing IDL for $p" >&2; exit 1; }
done

echo "==> anchor deploy --provider.cluster $CLUSTER"
anchor deploy --provider.cluster "$CLUSTER"

echo "==> deployed program ids (must equal declare_id!/Anchor.toml)"
for p in scadium_vault scadium_swap scadium_lottery; do
  echo "  $p: $(solana-keygen pubkey "target/deploy/${p}-keypair.json")"
done

echo "==> IDL upload (anchor idl init — ignore 'already in use' on re-deploys)"
for p in scadium_vault scadium_swap scadium_lottery; do
  id=$(solana-keygen pubkey "target/deploy/${p}-keypair.json")
  anchor idl init --provider.cluster "$CLUSTER" -f "target/idl/$p.json" "$id" || true
done

echo "==> done"
