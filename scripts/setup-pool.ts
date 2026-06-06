/**
 * One-time SCAD/SOL pool init + liquidity seed.
 *
 * Idempotent: skips init if the pool account exists, skips seeding if the
 * pool already has reserves. Initial price comes from the seed ratio —
 * defaults mirror the demo token page (~$0.03/SCAD at $150/SOL →
 * 5000 SCAD per SOL).
 *
 * Usage:
 *   RPC=http://127.0.0.1:8899 SWAP_PROGRAM_ID=<id> SCAD_MINT=<mint> \
 *   [SEED_SOL=20] [SEED_SCAD=100000] \
 *     pnpm exec ts-node --project tsconfig.anchor.json -T scripts/setup-pool.ts
 */
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import idl from '../target/idl/scadium_swap.json';

async function main() {
  const rpc = process.env.RPC ?? 'http://127.0.0.1:8899';
  const scadMint = new PublicKey(process.env.SCAD_MINT!);
  const seedSol = Number(process.env.SEED_SOL ?? 20);
  const seedScad = Number(process.env.SEED_SCAD ?? 100_000);

  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8')) as number[],
    ),
  );
  const connection = new Connection(rpc, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: 'confirmed',
  });
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const programId = program.programId;

  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  const pool = pda(Buffer.from('pool'));
  const solVault = pda(Buffer.from('sol_vault'));
  const lpMint = pda(Buffer.from('lp_mint'));
  const poolScad = getAssociatedTokenAddressSync(scadMint, pool, true);

  if (await connection.getAccountInfo(pool)) {
    console.log(`pool already initialized at ${pool.toBase58()}`);
  } else {
    const sig = await program.methods
      .initPool(100) // 1% LP fee, solpump-terminal-like
      .accounts({
        pool,
        solVault,
        scadMint,
        lpMint,
        poolScad,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`init_pool: ${sig}`);
  }

  const solReserve = await connection.getBalance(solVault);
  if (solReserve > LAMPORTS_PER_SOL) {
    console.log(`pool already seeded (${solReserve / LAMPORTS_PER_SOL} SOL)`);
  } else {
    const sig = await program.methods
      .addLiquidity(
        new anchor.BN((BigInt(seedScad) * 10n ** 9n).toString()),
        new anchor.BN(Math.round(seedSol * LAMPORTS_PER_SOL)),
        new anchor.BN(0),
      )
      .accounts({
        pool,
        solVault,
        poolScad,
        lpMint,
        userScad: getAssociatedTokenAddressSync(scadMint, payer.publicKey),
        userLp: getAssociatedTokenAddressSync(lpMint, payer.publicKey),
        scadMint,
        user: payer.publicKey,
      })
      .rpc();
    console.log(`seeded ${seedScad} SCAD + ${seedSol} SOL: ${sig}`);
  }

  console.log({
    programId: programId.toBase58(),
    pool: pool.toBase58(),
    solVault: solVault.toBase58(),
    lpMint: lpMint.toBase58(),
    poolScad: poolScad.toBase58(),
  });
  console.log(`\nAdd to .env:\nSWAP_PROGRAM_ID=${programId.toBase58()}`);
}

void main().then(() => process.exit(0));
