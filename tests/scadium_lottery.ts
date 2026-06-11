import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from '@solana/web3.js';
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { createHash } from 'crypto';
import { assert } from 'chai';

/**
 * scadium_lottery (PancakeSwap-style 6-digit $SCAD) invariants:
 *  - commit → buy (SCAD moves, 6 digits validated) → bulk buy (discounted) →
 *    reveal (sha256 assert, derives 6-digit number from a live slot hash) →
 *    inject / pay_prize (idempotent per winner) / burn_pool (reduces supply).
 */
describe('scadium_lottery', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.scadiumLottery as Program;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const cosigner = Keypair.generate();
  const buyer = Keypair.generate();
  let scadMint: PublicKey;
  let config: PublicKey;
  let treasury: PublicKey;
  let pinnedSlot: number; // target_slot pinned at commit (#19b)

  // Poll until the validator has advanced to (and recorded) `slot`.
  const waitForSlot = async (slot: number) => {
    for (let i = 0; i < 200; i++) {
      if ((await provider.connection.getSlot('confirmed')) > slot) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`validator did not reach slot ${slot}`);
  };

  const SCAD = (n: bigint) => n * 10n ** 9n; // 9 decimals
  const TICKET_PRICE = SCAD(10n); // 10 SCAD (~$1)
  const DISCOUNT_DIVISOR = 2000n;
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
  const payoutPda = (index: number, winner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('payout'), new anchor.BN(index).toArrayLike(Buffer, 'le', 8), winner.toBuffer()],
      program.programId,
    )[0];

  before(async () => {
    for (const kp of [cosigner, buyer]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    scadMint = await createMint(provider.connection, payer, payer.publicKey, null, 9);
    config = PublicKey.findProgramAddressSync([Buffer.from('lottery')], program.programId)[0];
    treasury = getAssociatedTokenAddressSync(scadMint, config, true);

    // Buyer gets 1,000 SCAD; cosigner gets 1,000 SCAD for injection.
    const buyerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      scadMint,
      buyer.publicKey,
    );
    await mintTo(provider.connection, payer, scadMint, buyerAta.address, payer, SCAD(1_000n));
    const cosignerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      scadMint,
      cosigner.publicKey,
    );
    await mintTo(provider.connection, payer, scadMint, cosignerAta.address, payer, SCAD(1_000n));
  });

  it('init_lottery', async () => {
    await program.methods
      .initLottery(
        cosigner.publicKey,
        new anchor.BN(TICKET_PRICE.toString()),
        new anchor.BN(DISCOUNT_DIVISOR.toString()),
      )
      .accounts({
        config,
        scadMint,
        treasuryScad: treasury,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const cfg = await (program.account as any).lotteryConfig.fetch(config);
    assert.equal(cfg.ticketPrice.toString(), TICKET_PRICE.toString());
    assert.equal(cfg.discountDivisor.toString(), DISCOUNT_DIVISOR.toString());

    // Seed the prize treasury (pool float).
    await mintTo(provider.connection, payer, scadMint, treasury, payer, SCAD(1_000n));
  });

  it('commit_draw publishes the seed hash and pins a future target slot (#19b)', async () => {
    const drawAt = Math.floor(Date.now() / 1000) + 3600;
    // Pin a slot a few ahead — its hash cannot exist yet, so the cosigner can't
    // grind the reveal; close enough that it stays inside the SlotHashes window.
    pinnedSlot = (await provider.connection.getSlot('confirmed')) + 3;
    await program.methods
      .commitDraw(DRAW_INDEX, seedHash, clientSeed, new anchor.BN(drawAt), new anchor.BN(pinnedSlot))
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
    assert.equal(d.targetSlot.toString(), pinnedSlot.toString());
  });

  it('inject tops up the pool with cosigner SCAD', async () => {
    const before = (await getAccount(provider.connection, treasury)).amount;
    await program.methods
      .inject(DRAW_INDEX, new anchor.BN(SCAD(100n).toString()))
      .accounts({
        config,
        draw: drawPda(1),
        injectorScad: getAssociatedTokenAddressSync(scadMint, cosigner.publicKey),
        treasuryScad: treasury,
        scadMint,
        cosigner: cosigner.publicKey,
      })
      .signers([cosigner])
      .rpc();
    const after = (await getAccount(provider.connection, treasury)).amount;
    assert.equal(after - before, SCAD(100n));
  });

  it('buy_ticket moves one ticket price of SCAD into the treasury', async () => {
    const before = (await getAccount(provider.connection, treasury)).amount;
    await program.methods
      .buyTicket(DRAW_INDEX, [1, 5, 9, 0, 3, 7])
      .accounts({
        config,
        draw: drawPda(1),
        buyerScad: getAssociatedTokenAddressSync(scadMint, buyer.publicKey),
        treasuryScad: treasury,
        scadMint,
        buyer: buyer.publicKey,
      })
      .signers([buyer])
      .rpc();
    const after = (await getAccount(provider.connection, treasury)).amount;
    assert.equal(after - before, TICKET_PRICE);
    const d = await (program.account as any).draw.fetch(drawPda(1));
    assert.equal(d.ticketCount, 1);
  });

  it('buy_tickets applies the PancakeSwap bulk discount', async () => {
    const before = (await getAccount(provider.connection, treasury)).amount;
    const n = 3n;
    const picks = [
      { digits: [0, 0, 0, 0, 0, 1] },
      { digits: [9, 9, 9, 9, 9, 9] },
      { digits: [1, 2, 3, 4, 5, 6] },
    ];
    await program.methods
      .buyTickets(DRAW_INDEX, picks)
      .accounts({
        config,
        draw: drawPda(1),
        buyerScad: getAssociatedTokenAddressSync(scadMint, buyer.publicKey),
        treasuryScad: treasury,
        scadMint,
        buyer: buyer.publicKey,
      })
      .signers([buyer])
      .rpc();
    const after = (await getAccount(provider.connection, treasury)).amount;
    const expected = (TICKET_PRICE * n * (DISCOUNT_DIVISOR + 1n - n)) / DISCOUNT_DIVISOR;
    assert.equal(after - before, expected);
  });

  it('rejects an invalid digit (>9)', async () => {
    try {
      await program.methods
        .buyTicket(DRAW_INDEX, [1, 5, 9, 0, 3, 10]) // 10 is out of range
        .accounts({
          config,
          draw: drawPda(1),
          buyerScad: getAssociatedTokenAddressSync(scadMint, buyer.publicKey),
          treasuryScad: treasury,
          scadMint,
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
        .revealDraw(DRAW_INDEX, wrongSeed)
        .accounts({
          config,
          draw: drawPda(1),
          cosigner: cosigner.publicKey,
          slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        })
        .signers([cosigner])
        .rpc();
      assert.fail('should have thrown');
    } catch (e) {
      assert.include(String(e), 'SeedMismatch');
    }
  });

  it('rejects a reveal before the pinned slot is reachable (#19b)', async () => {
    // A fresh draw whose target slot is far in the future → its hash is not yet
    // in SlotHashes, so reveal must fail TargetSlotNotAvailable.
    const farIndex = new anchor.BN(99);
    const drawAt = Math.floor(Date.now() / 1000) + 3600;
    const farSlot = (await provider.connection.getSlot('confirmed')) + 1_000_000;
    await program.methods
      .commitDraw(farIndex, seedHash, clientSeed, new anchor.BN(drawAt), new anchor.BN(farSlot))
      .accounts({
        config,
        draw: drawPda(99),
        cosigner: cosigner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([cosigner])
      .rpc();
    try {
      await program.methods
        .revealDraw(farIndex, seedBytes)
        .accounts({
          config,
          draw: drawPda(99),
          cosigner: cosigner.publicKey,
          slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        })
        .signers([cosigner])
        .rpc();
      assert.fail('should have thrown');
    } catch (e) {
      assert.include(String(e), 'TargetSlotNotAvailable');
    }
  });

  it('reveal_draw derives a 6-digit number from the PINNED slot hash (#19b)', async () => {
    await waitForSlot(pinnedSlot); // the pinned slot must exist in SlotHashes
    await program.methods
      .revealDraw(DRAW_INDEX, seedBytes)
      .accounts({
        config,
        draw: drawPda(1),
        cosigner: cosigner.publicKey,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
      })
      .signers([cosigner])
      .rpc();
    const d = await (program.account as any).draw.fetch(drawPda(1));
    // The program recorded the PINNED slot (not the newest) as the entropy slot.
    assert.equal(d.slot.toString(), pinnedSlot.toString());
    const digits = Array.from(d.winningDigits) as number[];
    assert.equal(digits.length, 6);
    for (const dig of digits) assert.isTrue(dig >= 0 && dig <= 9);
    assert.isTrue(Array.from(d.finalEntropy).some((b) => b !== 0));
  });

  it('pay_prize transfers SCAD to the winner and is idempotent', async () => {
    const winnerAta = getAssociatedTokenAddressSync(scadMint, buyer.publicKey);
    const before = (await getAccount(provider.connection, winnerAta)).amount;
    const prize = SCAD(50n);
    const accounts = {
      config,
      draw: drawPda(1),
      winner: buyer.publicKey,
      payout: payoutPda(1, buyer.publicKey),
      treasuryScad: treasury,
      winnerScad: winnerAta,
      scadMint,
      cosigner: cosigner.publicKey,
    };
    await program.methods
      .payPrize(DRAW_INDEX, new anchor.BN(prize.toString()), 5) // jackpot bracket
      .accounts(accounts)
      .signers([cosigner])
      .rpc();
    const after = (await getAccount(provider.connection, winnerAta)).amount;
    assert.equal(after - before, prize);

    // Replay must fail (Payout PDA already initialized).
    try {
      await program.methods
        .payPrize(DRAW_INDEX, new anchor.BN(prize.toString()), 5)
        .accounts(accounts)
        .signers([cosigner])
        .rpc();
      assert.fail('replay should have thrown');
    } catch (e) {
      assert.isTrue(/already in use|0x0/.test(String(e)));
    }
  });

  it('pay_prize REVERTS when the treasury cannot cover the prize (#29)', async () => {
    // Treasury was seeded SCAD(1000) and has paid 50 + sales — demand far more.
    const richWinner = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(richWinner.publicKey, LAMPORTS_PER_SOL),
      'confirmed',
    );
    const winnerAta = (
      await getOrCreateAssociatedTokenAccount(provider.connection, payer, scadMint, richWinner.publicKey)
    ).address;
    try {
      await program.methods
        .payPrize(DRAW_INDEX, new anchor.BN(SCAD(1_000_000n).toString()), 5)
        .accounts({
          config,
          draw: drawPda(1),
          winner: richWinner.publicKey,
          payout: payoutPda(1, richWinner.publicKey),
          treasuryScad: treasury,
          winnerScad: winnerAta,
          scadMint,
          cosigner: cosigner.publicKey,
        })
        .signers([cosigner])
        .rpc();
      assert.fail('should have thrown — treasury is underfunded');
    } catch (e) {
      // SPL token transfer fails with insufficient funds (0x1).
      assert.isTrue(/insufficient|0x1/i.test(String(e)));
    }
  });

  it('burn_pool reduces $SCAD supply', async () => {
    const burn = SCAD(20n);
    const supplyBefore = (await getMint(provider.connection, scadMint)).supply;
    await program.methods
      .burnPool(DRAW_INDEX, new anchor.BN(burn.toString()))
      .accounts({
        config,
        draw: drawPda(1),
        treasuryScad: treasury,
        scadMint,
        cosigner: cosigner.publicKey,
      })
      .signers([cosigner])
      .rpc();
    const supplyAfter = (await getMint(provider.connection, scadMint)).supply;
    assert.equal(supplyBefore - supplyAfter, burn);
  });
});
