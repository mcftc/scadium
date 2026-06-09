/**
 * One-time lottery setup (PancakeSwap-style $SCAD lottery): init_lottery with a
 * $SCAD-denominated ticket price + bulk-discount divisor, prize-treasury
 * funding, and a $SCAD stash for the cosigner (used for per-round injection and
 * the in-app faucet on devnet). $SCAD is the 9-decimal SPL mint created by
 * scripts/setup-scad.ts.
 *
 * Idempotent. Usage:
 *   RPC=http://127.0.0.1:8899 LOTTERY_PROGRAM_ID=<id> COSIGNER=<pubkey> \
 *   SCAD_MINT=<mint> [TREASURY_SCAD=1000000] [TICKET_PRICE_SCAD=10] \
 *     pnpm exec ts-node --project tsconfig.anchor.json -T scripts/setup-lottery.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getMint,
  mintTo,
} from '@solana/spl-token';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import idl from '../target/idl/scadium_lottery.json';

const SCAD_DECIMALS = 9n;
// Ticket price in whole SCAD (≈ $1 of SCAD at the demo rate). 10 SCAD default.
const TICKET_PRICE_SCAD = BigInt(process.env.TICKET_PRICE_SCAD ?? '10');
const TICKET_PRICE = TICKET_PRICE_SCAD * 10n ** SCAD_DECIMALS;
// PancakeSwap bulk-discount divisor (≈4.95% off at 100 tickets).
const DISCOUNT_DIVISOR = 2000n;

async function main() {
  const rpc = process.env.RPC ?? 'http://127.0.0.1:8899';
  const cosigner = new PublicKey(process.env.COSIGNER!);
  const scadMint = new PublicKey(process.env.SCAD_MINT!); // from setup-scad.ts
  const treasuryScad = BigInt(process.env.TREASURY_SCAD ?? '1000000'); // 1M SCAD default pool float

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
  console.log(`SCAD mint: ${scadMint.toBase58()}`);

  const config = PublicKey.findProgramAddressSync(
    [Buffer.from('lottery')],
    program.programId,
  )[0];
  const treasury = getAssociatedTokenAddressSync(scadMint, config, true);

  if (await connection.getAccountInfo(config)) {
    console.log(`lottery already initialized at ${config.toBase58()}`);
  } else {
    const sig = await program.methods
      .initLottery(
        cosigner,
        new anchor.BN(TICKET_PRICE.toString()),
        new anchor.BN(DISCOUNT_DIVISOR.toString()),
      )
      .accounts({
        config,
        scadMint,
        treasuryScad: treasury,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`init_lottery: ${sig} (ticket ${TICKET_PRICE_SCAD} SCAD, divisor ${DISCOUNT_DIVISOR})`);
  }

  // Prize treasury (pool float) + cosigner injection/faucet stash.
  const mintInfo = await getMint(connection, scadMint);
  if (mintInfo.mintAuthority?.equals(payer.publicKey)) {
    const treasuryAcct = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      scadMint,
      config,
      true,
    );
    const targetTreasury = treasuryScad * 10n ** SCAD_DECIMALS;
    if (treasuryAcct.amount < targetTreasury) {
      await mintTo(connection, payer, scadMint, treasury, payer, targetTreasury - treasuryAcct.amount);
      console.log(`treasury funded to ${treasuryScad} SCAD`);
    }
    const cosignerAta = await getOrCreateAssociatedTokenAccount(connection, payer, scadMint, cosigner);
    const cosignerTarget = 1_000_000n * 10n ** SCAD_DECIMALS; // 1M SCAD for injection + faucet
    if (cosignerAta.amount < cosignerTarget) {
      await mintTo(connection, payer, scadMint, cosignerAta.address, payer, cosignerTarget - cosignerAta.amount);
      console.log('cosigner stash: 1,000,000 SCAD');
    }
  }

  console.log({
    programId: program.programId.toBase58(),
    config: config.toBase58(),
    treasury: treasury.toBase58(),
    scadMint: scadMint.toBase58(),
  });
  console.log(`\nAdd to .env:\nLOTTERY_PROGRAM_ID=${program.programId.toBase58()}\nSCAD_MINT=${scadMint.toBase58()}`);
}

void main().then(() => process.exit(0));
