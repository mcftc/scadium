/**
 * One-time lottery setup: demo USDT mint (6 decimals, like the real one),
 * init_lottery (0.1 USDT tickets), prize-treasury funding, and a USDT
 * stash for the cosigner (used by the in-app faucet on devnet).
 *
 * Idempotent. Usage:
 *   RPC=http://127.0.0.1:8899 LOTTERY_PROGRAM_ID=<id> COSIGNER=<pubkey> \
 *   [USDT_MINT=<mint>] [TREASURY_USDT=200000] \
 *     pnpm exec ts-node --project tsconfig.anchor.json -T scripts/setup-lottery.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getMint,
  mintTo,
} from '@solana/spl-token';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import idl from '../target/idl/scadium_lottery.json';

const TICKET_PRICE = 100_000n; // 0.1 USDT @ 6 decimals

async function main() {
  const rpc = process.env.RPC ?? 'http://127.0.0.1:8899';
  const cosigner = new PublicKey(process.env.COSIGNER!);
  const treasuryUsd = BigInt(process.env.TREASURY_USDT ?? '200000'); // $200k default

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

  const usdtMint = process.env.USDT_MINT
    ? new PublicKey(process.env.USDT_MINT)
    : await createMint(connection, payer, payer.publicKey, null, 6);
  console.log(`USDT (demo) mint: ${usdtMint.toBase58()}`);

  const config = PublicKey.findProgramAddressSync(
    [Buffer.from('lottery')],
    program.programId,
  )[0];
  const treasury = getAssociatedTokenAddressSync(usdtMint, config, true);

  if (await connection.getAccountInfo(config)) {
    console.log(`lottery already initialized at ${config.toBase58()}`);
  } else {
    const sig = await program.methods
      .initLottery(cosigner, new anchor.BN(TICKET_PRICE.toString()))
      .accounts({
        config,
        usdtMint,
        treasuryUsdt: treasury,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`init_lottery: ${sig}`);
  }

  // Prize treasury + cosigner faucet stash.
  const mintInfo = await getMint(connection, usdtMint);
  if (mintInfo.mintAuthority?.equals(payer.publicKey)) {
    const treasuryAcct = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      usdtMint,
      config,
      true,
    );
    if (treasuryAcct.amount < treasuryUsd * 10n ** 6n) {
      await mintTo(
        connection,
        payer,
        usdtMint,
        treasury,
        payer,
        treasuryUsd * 10n ** 6n - treasuryAcct.amount,
      );
      console.log(`treasury funded to ${treasuryUsd} USDT`);
    }
    const cosignerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      usdtMint,
      cosigner,
    );
    if (cosignerAta.amount < 10_000n * 10n ** 6n) {
      await mintTo(connection, payer, usdtMint, cosignerAta.address, payer, 10_000n * 10n ** 6n);
      console.log('cosigner faucet stash: 10,000 USDT');
    }
  }

  console.log({
    programId: program.programId.toBase58(),
    config: config.toBase58(),
    treasury: treasury.toBase58(),
    usdtMint: usdtMint.toBase58(),
  });
  console.log(`\nAdd to .env:\nLOTTERY_PROGRAM_ID=${program.programId.toBase58()}\nUSDT_MINT=${usdtMint.toBase58()}`);
}

void main().then(() => process.exit(0));
