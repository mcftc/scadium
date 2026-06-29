/**
 * One-time $SCAD token setup — FINALIZED tokenomics (mirrors `SCAD` in
 * `@scadium/shared`): fixed max supply 1,000,000,000 (1B), 9 decimals, 6-way
 * allocation (P2E 50% · Community 10% · Liquidity 10% · Treasury 15% · Team 10%
 * · Strategic 5%).
 *
 * Creates (or reuses via SCAD_MINT) the SPL mint, then mints the full supply:
 *  - the CLAIMABLE pools — P2E emission (50%) + Community/Airdrop (10%) = 60% —
 *    land in the house PDA's treasury ATA (the source `claim_reward`/airdrop
 *    transfer from), and
 *  - the remaining 40% (Liquidity + Treasury + Team + Strategic) stays with the
 *    payer for the demo (LP seeding / treasury custody).
 * Idempotent: skips minting if supply already > 0.
 *
 * Usage:
 *   RPC=https://api.devnet.solana.com VAULT_PROGRAM_ID=<id> [SCAD_MINT=<mint>] \
 *     pnpm exec ts-node --project tsconfig.anchor.json -T scripts/setup-scad.ts
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint, getMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const DECIMALS = 9;
// FINALIZED tokenomics (mirrors `SCAD` in @scadium/shared): fixed max supply 1B.
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 9n; // base units (1B × 1e9)
// 6-way allocation. The CLAIMABLE pools — P2E emission (50%) + Community/Airdrop
// (10%) = 60% — fund the house treasury (the claim_reward / airdrop source); the
// rest (Liquidity + Treasury + Team + Strategic = 40%) stays with the payer.
const ALLOC_CLAIMABLE = (TOTAL_SUPPLY * 60n) / 100n;
const ALLOC_PAYER = TOTAL_SUPPLY - ALLOC_CLAIMABLE;

async function main() {
  const rpc = process.env.RPC ?? 'http://127.0.0.1:8899';
  const programId = new PublicKey(process.env.VAULT_PROGRAM_ID!);
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8')) as number[],
    ),
  );
  const connection = new Connection(rpc, 'confirmed');

  const mint = process.env.SCAD_MINT
    ? new PublicKey(process.env.SCAD_MINT)
    : await createMint(connection, payer, payer.publicKey, null, DECIMALS);
  console.log(`SCAD mint: ${mint.toBase58()}`);

  const [house] = PublicKey.findProgramAddressSync([Buffer.from('house')], programId);
  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    house,
    true, // house is a PDA (off-curve)
  );
  const payerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey,
  );

  const info = await getMint(connection, mint);
  if (info.supply > 0n) {
    console.log(`supply already minted (${info.supply}) — skipping`);
  } else {
    // The 40% non-claimable allocation stays with the payer for the demo; the
    // 60% claimable (P2E + Community) lands in the treasury the program
    // transfers claim_reward / airdrop payouts from.
    await mintTo(connection, payer, mint, payerAta.address, payer, ALLOC_PAYER);
    await mintTo(connection, payer, mint, treasuryAta.address, payer, ALLOC_CLAIMABLE);
    console.log(`minted: payer=${ALLOC_PAYER} treasury(claimable)=${ALLOC_CLAIMABLE}`);
  }

  console.log({
    mint: mint.toBase58(),
    house: house.toBase58(),
    treasuryAta: treasuryAta.address.toBase58(),
    payerAta: payerAta.address.toBase58(),
  });
  console.log(`\nAdd to .env:\nSCAD_MINT=${mint.toBase58()}`);
}

void main().then(() => process.exit(0));
