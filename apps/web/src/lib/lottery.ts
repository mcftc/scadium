import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ata } from './swap';

/**
 * Client-side builder for the scadium_lottery user-signed `buy_ticket`
 * instruction: transfers 0.1 USDT from the buyer into the lottery treasury
 * and records the picks in a TicketBought event. Same hand-rolled Anchor
 * encoding pattern as lib/vault.ts / lib/swap.ts.
 */

const DISC_BUY_TICKET = Uint8Array.from([11, 24, 17, 193, 168, 116, 164, 169]);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export function lotteryPdas(programId: PublicKey, drawIndex: bigint) {
  const config = PublicKey.findProgramAddressSync([Buffer.from('lottery')], programId)[0];
  const idx = new Uint8Array(8);
  new DataView(idx.buffer).setBigUint64(0, drawIndex, true);
  const draw = PublicKey.findProgramAddressSync([Buffer.from('draw'), idx], programId)[0];
  return { config, draw };
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
