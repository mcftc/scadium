import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

/**
 * Client-side builders for the scadium_vault program's USER-signed
 * instructions (deposit / withdraw). Anchor encoding is assembled by hand:
 * 8-byte discriminator (sha256("global:<name>")[0..8], precomputed) + borsh
 * args — which keeps the anchor IDL out of the web bundle.
 */

// sha256("global:deposit")[0..8] etc. — computed offline, stable per name.
const DISC_DEPOSIT = Uint8Array.from([242, 35, 198, 137, 82, 225, 242, 182]);
const DISC_WITHDRAW = Uint8Array.from([183, 18, 70, 156, 148, 109, 161, 34]);

export function userVaultPda(programId: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_vault'), user.toBuffer()],
    programId,
  )[0];
}

function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

export function buildDepositTx(
  programId: PublicKey,
  user: PublicKey,
  lamports: bigint,
): Transaction {
  const data = Buffer.concat([DISC_DEPOSIT, u64le(lamports)]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: userVaultPda(programId, user), isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return new Transaction().add(ix);
}

export function buildWithdrawTx(
  programId: PublicKey,
  user: PublicKey,
  lamports: bigint,
): Transaction {
  const data = Buffer.concat([DISC_WITHDRAW, u64le(lamports)]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: userVaultPda(programId, user), isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
    ],
    data,
  });
  return new Transaction().add(ix);
}
