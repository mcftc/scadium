import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ata } from './swap';

/**
 * Client-side builder for the scadium_lottery user-signed `buy_ticket(s)`
 * instructions: transfer $SCAD from the buyer into the lottery treasury and
 * record the 6-digit picks in a TicketBought event. Same hand-rolled Anchor
 * encoding pattern as lib/vault.ts / lib/swap.ts. Instruction names are
 * unchanged, so the discriminators are stable.
 */

const DISC_BUY_TICKET = Uint8Array.from([11, 24, 17, 193, 168, 116, 164, 169]);
const DISC_BUY_TICKETS = Uint8Array.from([48, 16, 122, 137, 24, 214, 198, 58]);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export function lotteryPdas(programId: PublicKey, drawIndex: bigint) {
  const config = PublicKey.findProgramAddressSync([Buffer.from('lottery')], programId)[0];
  const idx = new Uint8Array(8);
  new DataView(idx.buffer).setBigUint64(0, drawIndex, true);
  const draw = PublicKey.findProgramAddressSync([Buffer.from('draw'), idx], programId)[0];
  return { config, draw };
}

function buyKeys(programId: PublicKey, scadMint: PublicKey, buyer: PublicKey, drawIndex: bigint) {
  const { config, draw } = lotteryPdas(programId, drawIndex);
  return [
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: draw, isSigner: false, isWritable: true },
    { pubkey: ata(scadMint, buyer), isSigner: false, isWritable: true },
    { pubkey: ata(scadMint, config), isSigner: false, isWritable: true },
    { pubkey: scadMint, isSigner: false, isWritable: false },
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

/**
 * Batch purchase via `buy_tickets`: up to MAX_TICKETS_PER_TX picks in ONE
 * transaction — a single bulk-discounted $SCAD transfer and one TicketBought
 * event per pick. Borsh layout: u64le drawIndex + Vec<TicketPick> (u32le len,
 * then 6 bytes per pick: digits[6]).
 */
export function buildBuyTicketsTx(
  programId: PublicKey,
  scadMint: PublicKey,
  buyer: PublicKey,
  drawIndex: bigint,
  picks: { digits: number[] }[],
): Transaction {
  const idx = new Uint8Array(8);
  new DataView(idx.buffer).setBigUint64(0, drawIndex, true);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, picks.length, true);
  const data = Buffer.concat([
    DISC_BUY_TICKETS,
    idx,
    len,
    ...picks.map((p) => Uint8Array.from(p.digits)),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: buyKeys(programId, scadMint, buyer, drawIndex),
    data,
  });
  return new Transaction().add(ix);
}

export function buildBuyTicketTx(
  programId: PublicKey,
  scadMint: PublicKey,
  buyer: PublicKey,
  drawIndex: bigint,
  digits: number[],
): Transaction {
  const idx = new Uint8Array(8);
  new DataView(idx.buffer).setBigUint64(0, drawIndex, true);
  const data = Buffer.concat([DISC_BUY_TICKET, idx, Uint8Array.from(digits)]);
  const ix = new TransactionInstruction({
    programId,
    keys: buyKeys(programId, scadMint, buyer, drawIndex),
    data,
  });
  return new Transaction().add(ix);
}
