import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ata } from './swap';

/**
 * Client-side builder for the scadium_lottery user-signed `buy_ticket`
 * instruction: transfers 0.1 USDT from the buyer into the lottery treasury
 * and records the picks in a TicketBought event. Same hand-rolled Anchor
 * encoding pattern as lib/vault.ts / lib/swap.ts.
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

/**
 * Batch purchase via `buy_tickets`: up to 20 picks in ONE transaction — a
 * single USDT transfer of n×price and one TicketBought event per pick.
 * Borsh layout: u64le drawIndex + Vec<TicketPick> (u32le len, then 6 bytes
 * per pick: main[5] + bonus).
 */
export function buildBuyTicketsTx(
  programId: PublicKey,
  usdtMint: PublicKey,
  buyer: PublicKey,
  drawIndex: bigint,
  picks: { main: number[]; bonus: number }[],
): Transaction {
  const { config, draw } = lotteryPdas(programId, drawIndex);
  const idx = new Uint8Array(8);
  new DataView(idx.buffer).setBigUint64(0, drawIndex, true);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, picks.length, true);
  const data = Buffer.concat([
    DISC_BUY_TICKETS,
    idx,
    len,
    ...picks.map((p) => Uint8Array.from([...p.main, p.bonus])),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: draw, isSigner: false, isWritable: true },
      { pubkey: ata(usdtMint, buyer), isSigner: false, isWritable: true },
      { pubkey: ata(usdtMint, config), isSigner: false, isWritable: true },
      { pubkey: usdtMint, isSigner: false, isWritable: false },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
  return new Transaction().add(ix);
}

export function buildBuyTicketTx(
  programId: PublicKey,
  usdtMint: PublicKey,
  buyer: PublicKey,
  drawIndex: bigint,
  main: number[],
  bonus: number,
): Transaction {
  const { config, draw } = lotteryPdas(programId, drawIndex);
  const idx = new Uint8Array(8);
  new DataView(idx.buffer).setBigUint64(0, drawIndex, true);
  const data = Buffer.concat([
    DISC_BUY_TICKET,
    idx,
    Uint8Array.from(main),
    Uint8Array.from([bonus]),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: draw, isSigner: false, isWritable: true },
      { pubkey: ata(usdtMint, buyer), isSigner: false, isWritable: true },
      { pubkey: ata(usdtMint, config), isSigner: false, isWritable: true },
      { pubkey: usdtMint, isSigner: false, isWritable: false },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
  return new Transaction().add(ix);
}
