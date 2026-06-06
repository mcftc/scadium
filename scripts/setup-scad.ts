/**
 * One-time $SCAD token setup (whitepaper allocations).
 *
 * Creates (or reuses via SCAD_MINT) the SPL mint, then mints the
 * 217,755,972 supply: 10% team → payer ATA, 40% rewards → the house PDA's
 * treasury ATA (claim_reward source), 50% users → payer ATA (held for
 * distribution). Idempotent: skips minting if supply already > 0.
 *
 * Usage:
 *   RPC=http://127.0.0.1:8899 VAULT_PROGRAM_ID=<id> [SCAD_MINT=<mint>] \
 *     pnpm exec ts-node --project tsconfig.anchor.json -T scripts/setup-scad.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const DECIMALS = 9;
const TOTAL_SUPPLY = 217_755_972n * 10n ** 9n; // base units
const ALLOC_TEAM = (TOTAL_SUPPLY * 10n) / 100n;
const ALLOC_REWARDS = (TOTAL_SUPPLY * 40n) / 100n;
const ALLOC_USERS = TOTAL_SUPPLY - ALLOC_TEAM - ALLOC_REWARDS;

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
    // Team + users allocations stay with the payer for the demo; rewards
    // land in the treasury the program transfers claims from.
    await mintTo(connection, payer, mint, payerAta.address, payer, ALLOC_TEAM + ALLOC_USERS);
    await mintTo(connection, payer, mint, treasuryAta.address, payer, ALLOC_REWARDS);
    console.log(`minted: team+users=${ALLOC_TEAM + ALLOC_USERS} rewards=${ALLOC_REWARDS}`);
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
