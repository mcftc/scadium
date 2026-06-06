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
import { createHash } from 'crypto';
import { assert } from 'chai';

/**
 * scadium_lottery invariants:
 *  - commit → buy (USDT moves, picks validated) → reveal (sha256 assert)
 *  - wrong seed reveal rejected; pay_prize transfers from treasury
 */
describe('scadium_lottery', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.scadiumLottery as Program;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const cosigner = Keypair.generate();
  const buyer = Keypair.generate();
  let usdtMint: PublicKey;
  let config: PublicKey;
  let treasury: PublicKey;

  const TICKET_PRICE = 100_000n; // 0.1 USDT (6 decimals)
  const DRAW_INDEX = new anchor.BN(1);
  const serverSeedHex = 'a'.repeat(64); // deterministic test seed
  const seedBytes = Array.from(Buffer.from(serverSeedHex, 'utf8')); // 64 utf8 bytes
  const seedHash = Array.from(createHash('sha256').update(serverSeedHex, 'utf8').digest());
  const clientSeed = Array.from(Buffer.alloc(32, 7));

  const drawPda = (index: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('draw'), new anchor.BN(index).toArrayLike(Buffer, 'le', 8)],
      program.programId,
    )[0];

  before(async () => {
    for (const kp of [cosigner, buyer]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    usdtMint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
    config = PublicKey.findProgramAddressSync([Buffer.from('lottery')], program.programId)[0];
    treasury = getAssociatedTokenAddressSync(usdtMint, config, true);

    // Buyer gets 10 USDT.
    const buyerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      usdtMint,
      buyer.publicKey,
    );
    await mintTo(provider.connection, payer, usdtMint, buyerAta.address, payer, 10_000_000n);
  });

  it('init_lottery', async () => {
    await program.methods
      .initLottery(cosigner.publicKey, new anchor.BN(TICKET_PRICE.toString()))
      .accounts({
        config,
        usdtMint,
        treasuryUsdt: treasury,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const cfg = await (program.account as any).lotteryConfig.fetch(config);
    assert.equal(cfg.ticketPrice.toNumber(), 100_000);

    // Fund the prize treasury (house lottery: fixed prizes).
    await mintTo(provider.connection, payer, usdtMint, treasury, payer, 1_000_000_000n); // 1000 USDT
  });

  it('commit_draw publishes the seed hash', async () => {
    const drawAt = Math.floor(Date.now() / 1000) + 3600;
    await program.methods
      .commitDraw(DRAW_INDEX, seedHash, clientSeed, new anchor.BN(drawAt))
      .accounts({
        config,
        draw: drawPda(1),
        cosigner: cosigner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([cosigner])
      .rpc();
    const d = await (program.account as any).draw.fetch(drawPda(1));
    assert.deepEqual(Array.from(d.serverSeedHash), seedHash);
  });

  it('buy_ticket moves 0.1 USDT into the treasury', async () => {
    const before = (await getAccount(provider.connection, treasury)).amount;
    await program.methods
      .buyTicket(DRAW_INDEX, [3, 7, 14, 22, 36], 5)
      .accounts({
        config,
        draw: drawPda(1),
        buyerUsdt: getAssociatedTokenAddressSync(usdtMint, buyer.publicKey),
        treasuryUsdt: treasury,
        usdtMint,
        buyer: buyer.publicKey,
      })
      .signers([buyer])
      .rpc();
    const after = (await getAccount(provider.connection, treasury)).amount;
    assert.equal(after - before, TICKET_PRICE);
    const d = await (program.account as any).draw.fetch(drawPda(1));
    assert.equal(d.ticketCount, 1);
  });

  it('rejects invalid picks', async () => {
    try {
      await program.methods
        .buyTicket(DRAW_INDEX, [3, 3, 14, 22, 36], 5) // duplicate
        .accounts({
          config,
          draw: drawPda(1),
          buyerUsdt: getAssociatedTokenAddressSync(usdtMint, buyer.publicKey),
          treasuryUsdt: treasury,
          usdtMint,
          buyer: buyer.publicKey,
        })
        .signers([buyer])
        .rpc();
      assert.fail('should have thrown');
    } catch (e) {
      assert.include(String(e), 'InvalidPick');
    }
  });

  it('rejects a reveal with the wrong seed', async () => {
    const wrongSeed = Array.from(Buffer.from('b'.repeat(64), 'utf8'));
    try {
      await program.methods
        .revealDraw(DRAW_INDEX, wrongSeed, [1, 2, 3, 4, 5], 1)
        .accounts({ config, draw: drawPda(1), cosigner: cosigner.publicKey })
        .signers([cosigner])
        .rpc();
      assert.fail('should have thrown');
    } catch (e) {
      assert.include(String(e), 'SeedMismatch');
    }
  });

  it('reveal_draw pins the winning numbers on-chain', async () => {
    await program.methods
      .revealDraw(DRAW_INDEX, seedBytes, [3, 7, 14, 22, 36], 5)
      .accounts({ config, draw: drawPda(1), cosigner: cosigner.publicKey })
      .signers([cosigner])
      .rpc();
    const d = await (program.account as any).draw.fetch(drawPda(1));
    assert.deepEqual(Array.from(d.winningMain), [3, 7, 14, 22, 36]);
    assert.equal(d.winningBonus, 5);
  });

  it('pay_prize transfers USDT to the winner', async () => {
    const winnerAta = getAssociatedTokenAddressSync(usdtMint, buyer.publicKey);
    const before = (await getAccount(provider.connection, winnerAta)).amount;
    await program.methods
      .payPrize(DRAW_INDEX, new anchor.BN(3_000_000_000 / 1000), 1) // $3 demo-scaled
      .accounts({
        config,
        draw: drawPda(1),
        winner: buyer.publicKey,
        treasuryUsdt: treasury,
        winnerUsdt: winnerAta,
        usdtMint,
        cosigner: cosigner.publicKey,
      })
      .signers([cosigner])
      .rpc();
    const after = (await getAccount(provider.connection, winnerAta)).amount;
    assert.equal(after - before, 3_000_000n);
  });
});
