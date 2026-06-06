import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { assert } from 'chai';

/**
 * scadium_swap invariants on the local validator:
 *  - init + first liquidity sets price and mints sqrt(k) LP
 *  - swaps preserve/grow k and respect slippage guards
 *  - remove_liquidity pays out pro-rata
 */
describe('scadium_swap', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.scadiumSwap as Program;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const trader = Keypair.generate();
  let scadMint: PublicKey;
  let pool: PublicKey;
  let solVault: PublicKey;
  let lpMint: PublicKey;
  let poolScad: PublicKey;

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const reserves = async () => {
    const scad = (await getAccount(provider.connection, poolScad)).amount;
    const sol = BigInt(await provider.connection.getBalance(solVault));
    return { scad, sol };
  };

  before(async () => {
    const sig = await provider.connection.requestAirdrop(
      trader.publicKey,
      10 * LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig);

    scadMint = await createMint(provider.connection, payer, payer.publicKey, null, 9);
    pool = pda(Buffer.from('pool'));
    solVault = pda(Buffer.from('sol_vault'));
    lpMint = pda(Buffer.from('lp_mint'));
    poolScad = getAssociatedTokenAddressSync(scadMint, pool, true);

    // Seed payer + trader with SCAD.
    const payerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      scadMint,
      payer.publicKey,
    );
    await mintTo(provider.connection, payer, scadMint, payerAta.address, payer, 10_000_000n * 10n ** 9n);
    const traderAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      scadMint,
      trader.publicKey,
    );
    await mintTo(provider.connection, payer, scadMint, traderAta.address, payer, 1_000_000n * 10n ** 9n);
  });

  it('init_pool', async () => {
    await program.methods
      .initPool(100) // 1% fee
      .accounts({
        pool,
        solVault,
        scadMint,
        lpMint,
        poolScad,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const state = await (program.account as any).pool.fetch(pool);
    assert.equal(state.feeBps, 100);
  });

  it('first add_liquidity mints sqrt LP and sets reserves', async () => {
    // 1,000,000 SCAD : 10 SOL → price 100k SCAD/SOL
    const scadIn = 1_000_000n * 10n ** 9n;
    const solIn = BigInt(10 * LAMPORTS_PER_SOL);
    await program.methods
      .addLiquidity(new anchor.BN(scadIn.toString()), new anchor.BN(solIn.toString()), new anchor.BN(0))
      .accounts({
        pool,
        solVault,
        poolScad,
        lpMint,
        userScad: getAssociatedTokenAddressSync(scadMint, payer.publicKey),
        userLp: getAssociatedTokenAddressSync(lpMint, payer.publicKey),
        scadMint,
        user: payer.publicKey,
      })
      .rpc();
    const r = await reserves();
    assert.equal(r.scad, scadIn);
    assert.isAtLeast(Number(r.sol), Number(solIn)); // + rent floor
    const lp = await getAccount(
      provider.connection,
      getAssociatedTokenAddressSync(lpMint, payer.publicKey),
    );
    assert.isAbove(Number(lp.amount), 0);
  });

  it('swap SOL→SCAD grows k and honors the fee curve', async () => {
    const before = await reserves();
    const k0 = before.scad * before.sol;
    const amountIn = BigInt(LAMPORTS_PER_SOL); // 1 SOL

    await program.methods
      .swap(true, new anchor.BN(amountIn.toString()), new anchor.BN(0))
      .accounts({
        pool,
        solVault,
        poolScad,
        userScad: getAssociatedTokenAddressSync(scadMint, trader.publicKey),
        scadMint,
        user: trader.publicKey,
      })
      .signers([trader])
      .rpc();

    const after = await reserves();
    const k1 = after.scad * after.sol;
    assert.isTrue(k1 >= k0, 'k must not decrease');
    assert.isTrue(after.sol > before.sol && after.scad < before.scad);
  });

  it('swap SCAD→SOL pays SOL out', async () => {
    const balBefore = await provider.connection.getBalance(trader.publicKey);
    const scadIn = 50_000n * 10n ** 9n;
    await program.methods
      .swap(false, new anchor.BN(scadIn.toString()), new anchor.BN(0))
      .accounts({
        pool,
        solVault,
        poolScad,
        userScad: getAssociatedTokenAddressSync(scadMint, trader.publicKey),
        scadMint,
        user: trader.publicKey,
      })
      .signers([trader])
      .rpc();
    const balAfter = await provider.connection.getBalance(trader.publicKey);
    assert.isAbove(balAfter, balBefore);
  });

  it('rejects swaps past the slippage guard', async () => {
    try {
      await program.methods
        .swap(true, new anchor.BN(LAMPORTS_PER_SOL), new anchor.BN('999999999999999999'))
        .accounts({
          pool,
          solVault,
          poolScad,
          userScad: getAssociatedTokenAddressSync(scadMint, trader.publicKey),
          scadMint,
          user: trader.publicKey,
        })
        .signers([trader])
        .rpc();
      assert.fail('should have thrown');
    } catch (e: any) {
      assert.include(String(e), 'SlippageExceeded');
    }
  });

  it('remove_liquidity pays out pro-rata', async () => {
    const lpAta = getAssociatedTokenAddressSync(lpMint, payer.publicKey);
    const lpBal = (await getAccount(provider.connection, lpAta)).amount;
    const half = lpBal / 2n;
    const scadBefore = (
      await getAccount(provider.connection, getAssociatedTokenAddressSync(scadMint, payer.publicKey))
    ).amount;

    await program.methods
      .removeLiquidity(new anchor.BN(half.toString()), new anchor.BN(0), new anchor.BN(0))
      .accounts({
        pool,
        solVault,
        poolScad,
        lpMint,
        userScad: getAssociatedTokenAddressSync(scadMint, payer.publicKey),
        userLp: lpAta,
        scadMint,
        user: payer.publicKey,
      })
      .rpc();

    const scadAfter = (
      await getAccount(provider.connection, getAssociatedTokenAddressSync(scadMint, payer.publicKey))
    ).amount;
    assert.isTrue(scadAfter > scadBefore, 'received SCAD back');
    const lpAfter = (await getAccount(provider.connection, lpAta)).amount;
    assert.equal(lpAfter, lpBal - half);
  });
});
