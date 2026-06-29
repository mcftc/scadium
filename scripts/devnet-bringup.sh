#!/usr/bin/env bash
# One-shot devnet bring-up: deploy ALL four programs, create the $SCAD + USDS
# SPL tokens, initialise the program configs (house / lottery / shared RNG), fund
# the cosigner, and print the .env block to paste. After this runs, solscan
# (?cluster=devnet) shows the deployed programs + the SCAD mint, and the API's
# on-chain anchoring (OnchainRngService) can be switched live.
#
# Prereqs: a FUNDED provider wallet (~/.config/solana/id.json). Devnet airdrops
# are rate-limited per IP — if `solana airdrop` is blocked, fund the wallet from
# the web faucet (https://faucet.solana.com, paste the address printed below)
# and re-run. Deploying ~1.2MB of programs needs ~9-12 SOL.
#
# Usage:  ./scripts/devnet-bringup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

RPC="https://api.devnet.solana.com"
ID_JSON="$HOME/.config/solana/id.json"
COSIGNER_KP=".keys/cosigner-devnet.json"
TS="pnpm exec ts-node --project tsconfig.anchor.json -T"

solana config set --url "$RPC" >/dev/null
PAYER=$(solana address)
echo "==> payer: $PAYER"

# --- 0) funding gate -------------------------------------------------------
BAL=$(solana balance | awk '{print $1}')
echo "==> balance: $BAL SOL"
if awk "BEGIN{exit !($BAL+0 < 9)}"; then
  echo "!! Need ~9-12 SOL to deploy 4 programs. Current: $BAL SOL."
  echo "!! Trying airdrops (often rate-limited)…"
  for i in 1 2 3 4 5 6; do solana airdrop 2 >/dev/null 2>&1 || true; sleep 2; done
  BAL=$(solana balance | awk '{print $1}')
  echo "==> balance after airdrop attempts: $BAL SOL"
  if awk "BEGIN{exit !($BAL+0 < 9)}"; then
    echo "!! Still underfunded. Fund $PAYER via https://faucet.solana.com then re-run."
    exit 1
  fi
fi

# --- 1) build + deploy all four programs -----------------------------------
echo "==> anchor build (generates .so + IDL, incl. scadium_rng)"
anchor build
echo "==> anchor deploy --provider.cluster devnet"
anchor deploy --provider.cluster devnet

VAULT_ID=$(solana-keygen pubkey target/deploy/scadium_vault-keypair.json)
SWAP_ID=$(solana-keygen pubkey target/deploy/scadium_swap-keypair.json)
LOTTERY_ID=$(solana-keygen pubkey target/deploy/scadium_lottery-keypair.json)
RNG_ID=$(solana-keygen pubkey target/deploy/scadium_rng-keypair.json)
echo "==> deployed: vault=$VAULT_ID swap=$SWAP_ID lottery=$LOTTERY_ID rng=$RNG_ID"

# --- 2) cosigner: fund with SOL (pays per-round RNG account rent) -----------
COSIGNER=$(solana address -k "$COSIGNER_KP")
echo "==> funding cosigner $COSIGNER with 1 SOL"
solana transfer "$COSIGNER" 1 --allow-unfunded-recipient --fee-payer "$ID_JSON" >/dev/null || true

# --- 3) tokens: $SCAD (9 dp, 1B) + USDS (6 dp) -----------------------------
echo "==> creating \$SCAD mint + minting the 1B 6-way supply (setup-scad.ts)"
SCAD_OUT=$(RPC="$RPC" VAULT_PROGRAM_ID="$VAULT_ID" $TS scripts/setup-scad.ts)
echo "$SCAD_OUT"
SCAD_MINT=$(echo "$SCAD_OUT" | grep -oE 'SCAD_MINT=[A-Za-z0-9]+' | head -1 | cut -d= -f2)

echo "==> creating USDS mint (6 dp, dividend stablecoin)"
USDS_MINT=$(spl-token create-token --decimals 6 --url "$RPC" | grep -oE 'Creating token [A-Za-z0-9]+' | awk '{print $3}')
spl-token create-account "$USDS_MINT" --url "$RPC" >/dev/null || true
spl-token mint "$USDS_MINT" 1000000 --url "$RPC" >/dev/null || true
echo "==> USDS mint: $USDS_MINT"

# --- 4) program configs: house, lottery, shared RNG ------------------------
echo "==> init house (scadium_vault)"
RPC="$RPC" SCAD_MINT="$SCAD_MINT" COSIGNER="$COSIGNER" $TS scripts/init-house.ts || true
echo "==> init lottery (scadium_lottery)"
RPC="$RPC" LOTTERY_PROGRAM_ID="$LOTTERY_ID" SCAD_MINT="$SCAD_MINT" COSIGNER="$COSIGNER" $TS scripts/setup-lottery.ts || true
echo "==> init shared RNG (scadium_rng)"
RPC="$RPC" RNG_PROGRAM_ID="$RNG_ID" COSIGNER="$COSIGNER" $TS scripts/setup-rng.ts || true

# --- 5) the .env block to paste --------------------------------------------
cat <<EOF

================= devnet bring-up complete =================
Paste into .env (then restart the API to go on-chain-live):

SOLANA_NETWORK=devnet
SOLANA_RPC_URL=$RPC
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_SOLANA_RPC=$RPC
VAULT_PROGRAM_ID=$VAULT_ID
SWAP_PROGRAM_ID=$SWAP_ID
LOTTERY_PROGRAM_ID=$LOTTERY_ID
RNG_PROGRAM_ID=$RNG_ID
SCAD_MINT=$SCAD_MINT
USDS_MINT=$USDS_MINT

Verify on solscan (?cluster=devnet):
  rng program : https://solscan.io/account/$RNG_ID?cluster=devnet
  \$SCAD mint  : https://solscan.io/token/$SCAD_MINT?cluster=devnet
============================================================
EOF
