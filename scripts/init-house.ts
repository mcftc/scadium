/**
 * One-time house initialization for scadium_vault.
 *
 * Usage:
 *   RPC=http://127.0.0.1:8899 SCAD_MINT=<mint> COSIGNER=<pubkey> \
 *     pnpm exec ts-node --project tsconfig.anchor.json scripts/init-house.ts
 *
 * Also seeds the house vault float. The float is DERIVED from the bankroll
 * model (#30, docs/bankroll-model.md), not hardcoded: full coverage means a
 * single MAX_WIN_PER_BET fits inside the MAX_ROUND_EXPOSURE_BPS round cap.
 * HOUSE_FLOAT_SOL overrides for dev/devnet, but must clear the hard minimum
 * (rent floor + alert buffer) — below full coverage the script prints the
 * reduced max single-round exposure the cap will enforce.
 */
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import idl from '../target/idl/scadium_vault.json';
import { HOUSE } from '../packages/shared/src/constants';

async function main() {
  const rpc = process.env.RPC ?? 'http://127.0.0.1:8899';
  const scadMint = new PublicKey(process.env.SCAD_MINT!);
  const cosigner = new PublicKey(process.env.COSIGNER!);

  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8')) as number[],
    ),
  );
  const connection = new Connection(rpc, 'confirmed');
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(idl as anchor.Idl, provider);

  const programId = program.programId;
  const [house] = PublicKey.findProgramAddressSync([Buffer.from('house')], programId);
  const [houseVault] = PublicKey.findProgramAddressSync([Buffer.from('house_vault')], programId);

  const existing = await connection.getAccountInfo(house);
  if (existing) {
    console.log(`house already initialized at ${house.toBase58()}`);
  } else {
    const sig = await program.methods
      .initHouse(cosigner)
      .accounts({
        house,
        houseVault,
        scadMint,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`init_house tx: ${sig}`);
  }

  // Seed the float so the house can pay net wins. Derived from the bankroll
  // model (#30): full coverage = the bankroll at which one MAX_WIN_PER_BET
  // fits inside the per-round exposure cap.
  const rentFloor = await connection.getMinimumBalanceForRentExemption(0);
  const minFloat = rentFloor + HOUSE.MIN_BANKROLL_BUFFER_LAMPORTS;
  const fullCoverage =
    Math.ceil((HOUSE.MAX_WIN_PER_BET_LAMPORTS * 10_000) / HOUSE.MAX_ROUND_EXPOSURE_BPS) +
    rentFloor;
  const target = process.env.HOUSE_FLOAT_SOL
    ? Number(process.env.HOUSE_FLOAT_SOL) * LAMPORTS_PER_SOL
    : fullCoverage;
  if (target < minFloat) {
    throw new Error(
      `HOUSE_FLOAT_SOL too low: ${target} lamports < hard minimum ${minFloat} ` +
        `(rent floor ${rentFloor} + buffer ${HOUSE.MIN_BANKROLL_BUFFER_LAMPORTS})`,
    );
  }
  if (target < fullCoverage) {
    const maxRoundExposure = Math.floor(
      ((target - rentFloor) * HOUSE.MAX_ROUND_EXPOSURE_BPS) / 10_000,
    );
    console.warn(
      `float ${target / LAMPORTS_PER_SOL} SOL is below full coverage ` +
        `(${fullCoverage / LAMPORTS_PER_SOL} SOL): the exposure cap limits each ` +
        `round's total potential payout to ~${maxRoundExposure / LAMPORTS_PER_SOL} SOL ` +
        `instead of the ${HOUSE.MAX_WIN_PER_BET_LAMPORTS / LAMPORTS_PER_SOL} SOL max win.`,
    );
  }
  const vaultInfo = await connection.getAccountInfo(houseVault);
  const current = vaultInfo?.lamports ?? 0;
  if (current < target) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: houseVault,
        lamports: target - current,
      }),
    );
    const sig = await provider.sendAndConfirm(tx);
    console.log(`house float topped up to ${target / LAMPORTS_PER_SOL} SOL: ${sig}`);
  }

  console.log({
    programId: programId.toBase58(),
    house: house.toBase58(),
    houseVault: houseVault.toBase58(),
    cosigner: cosigner.toBase58(),
    scadMint: scadMint.toBase58(),
  });
}

void main().then(() => process.exit(0));
