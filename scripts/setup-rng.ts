/**
 * One-time init for the shared `scadium_rng` program — registers the cosigner
 * allowed to open/settle rounds. This is the ONE program every game draws its
 * provably-fair entropy from (crash, dice, mines, …, lottery), so it must be
 * configured before the API's on-chain anchoring (`OnchainRngService`) goes live.
 *
 * IDL-free (mirrors apps/api/src/solana/chain.service.ts): the instruction is
 * Anchor-encoded by hand (8-byte discriminator = sha256("global:init_rng")[0..8]
 * + borsh(cosigner: Pubkey)), so the script never needs the generated IDL.
 *
 * Usage:
 *   RPC=https://api.devnet.solana.com RNG_PROGRAM_ID=<id> COSIGNER=<pubkey> \
 *     pnpm exec ts-node --project tsconfig.anchor.json -T scripts/setup-rng.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { homedir } from 'os';

function anchorDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const rpc = process.env.RPC ?? 'https://api.devnet.solana.com';
  const programId = new PublicKey(process.env.RNG_PROGRAM_ID!);
  // Default the cosigner to the payer if unset (single-keypair devnet demo).
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8')) as number[],
    ),
  );
  const cosigner = process.env.COSIGNER ? new PublicKey(process.env.COSIGNER) : payer.publicKey;

  const connection = new Connection(rpc, 'confirmed');
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('rng')], programId);

  const existing = await connection.getAccountInfo(config);
  if (existing) {
    console.log(`scadium_rng already initialized (config ${config.toBase58()})`);
  } else {
    const data = Buffer.concat([anchorDiscriminator('init_rng'), cosigner.toBuffer()]);
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: config, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], {
      commitment: 'confirmed',
    });
    console.log(`init_rng tx: ${sig}`);
  }

  console.log({
    programId: programId.toBase58(),
    config: config.toBase58(),
    cosigner: cosigner.toBase58(),
  });
  console.log(`\nAdd to .env (uncomment / set):\nRNG_PROGRAM_ID=${programId.toBase58()}`);
}

void main().then(() => process.exit(0));
