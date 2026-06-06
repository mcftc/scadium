import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

/**
 * Client-side builders for the scadium_swap pool (user-signed swaps and
 * liquidity ops) + the CPMM quote math used for est-receive/price-impact.
 * Anchor encoding assembled by hand with precomputed discriminators —
 * keeps the IDL out of the bundle (same pattern as lib/vault.ts).
 */

const DISC_SWAP = Uint8Array.from([248, 198, 158, 145, 225, 117, 135, 200]);
const DISC_ADD = Uint8Array.from([181, 157, 89, 67, 143, 182, 52, 72]);
const DISC_REMOVE = Uint8Array.from([80, 85, 209, 72, 24, 206, 177, 108]);

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

export function ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function swapPdas(programId: PublicKey) {
  const pda = (seed: string) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed)], programId)[0];
  return { pool: pda('pool'), solVault: pda('sol_vault'), lpMint: pda('lp_mint') };
}

function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

/** Constant-product quote with fee — mirrors the on-chain formula exactly. */
export function quoteSwap(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): { amountOut: bigint; priceImpactPct: number } {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return { amountOut: 0n, priceImpactPct: 0 };
  }
  const inAfterFee = (amountIn * BigInt(10_000 - feeBps)) / 10_000n;
  const amountOut = (inAfterFee * reserveOut) / (reserveIn + inAfterFee);
  // Impact = 1 − (execution price / spot price)
  const spot = Number(reserveOut) / Number(reserveIn);
  const exec = Number(amountOut) / Number(amountIn);
  const priceImpactPct = spot > 0 ? Math.max(0, (1 - exec / spot) * 100) : 0;
  return { amountOut, priceImpactPct };
}

export function buildSwapTx(
  programId: PublicKey,
  scadMint: PublicKey,
  user: PublicKey,
  solToScad: boolean,
  amountIn: bigint,
  minAmountOut: bigint,
): Transaction {
  const { pool, solVault } = swapPdas(programId);
  const data = Buffer.concat([
    DISC_SWAP,
    Uint8Array.from([solToScad ? 1 : 0]),
    u64le(amountIn),
    u64le(minAmountOut),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: ata(scadMint, pool), isSigner: false, isWritable: true },
      { pubkey: ata(scadMint, user), isSigner: false, isWritable: true },
      { pubkey: scadMint, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return new Transaction().add(ix);
}

export function buildAddLiquidityTx(
  programId: PublicKey,
  scadMint: PublicKey,
  user: PublicKey,
  scadAmount: bigint,
  solAmount: bigint,
  minLp: bigint,
): Transaction {
  const { pool, solVault, lpMint } = swapPdas(programId);
  const data = Buffer.concat([DISC_ADD, u64le(scadAmount), u64le(solAmount), u64le(minLp)]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: ata(scadMint, pool), isSigner: false, isWritable: true },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: ata(scadMint, user), isSigner: false, isWritable: true },
      { pubkey: ata(lpMint, user), isSigner: false, isWritable: true },
      { pubkey: scadMint, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return new Transaction().add(ix);
}

export function buildRemoveLiquidityTx(
  programId: PublicKey,
  scadMint: PublicKey,
  user: PublicKey,
  lpAmount: bigint,
  minScad: bigint,
  minSol: bigint,
): Transaction {
  const { pool, solVault, lpMint } = swapPdas(programId);
  const data = Buffer.concat([DISC_REMOVE, u64le(lpAmount), u64le(minScad), u64le(minSol)]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: ata(scadMint, pool), isSigner: false, isWritable: true },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: ata(scadMint, user), isSigner: false, isWritable: true },
      { pubkey: ata(lpMint, user), isSigner: false, isWritable: true },
      { pubkey: scadMint, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
  return new Transaction().add(ix);
}
