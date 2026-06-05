/**
 * One-time house initialization for scadium_vault.
 *
 * Usage:
 *   RPC=http://127.0.0.1:8899 SCAD_MINT=<mint> COSIGNER=<pubkey> \
 *     pnpm exec ts-node --project tsconfig.anchor.json scripts/init-house.ts
 *
 * Also seeds the house vault float (HOUSE_FLOAT_SOL, default 2).
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

async function main() {
  const rpc = process.env.RPC ?? 'http://127.0.0.1:8899';
  const scadMint = new PublicKey(process.env.SCAD_MINT!);
  const cosigner = new PublicKey(process.env.COSIGNER!);
  const floatSol = Number(process.env.HOUSE_FLOAT_SOL ?? 2);

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

  // Seed the float so the house can pay net wins.
  const vaultInfo = await connection.getAccountInfo(houseVault);
  const current = vaultInfo?.lamports ?? 0;
  const target = floatSol * LAMPORTS_PER_SOL;
  if (current < target) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: houseVault,
        lamports: target - current,
      }),
    );
    const sig = await provider.sendAndConfirm(tx);
    console.log(`house float topped up to ${floatSol} SOL: ${sig}`);
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
