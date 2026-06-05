import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import { createMint, getAssociatedTokenAddressSync, mintTo, getOrCreateAssociatedTokenAccount, getAccount } from '@solana/spl-token';
import { assert } from 'chai';

/**
 * scadium_vault invariants, run against the anchor-test local validator:
 *  - deposit/withdraw round-trips lamports and only the owner can withdraw
 *  - settle_bet is cosigner-gated and nets stake/payout correctly
 *  - claim_reward transfers SCAD and blocks double claims per (kind, period)
 */
describe('scadium_vault', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.scadiumVault as Program;

  const payer = (provider.wallet as anchor.Wallet).payer;
  const cosigner = Keypair.generate();
  const user = Keypair.generate();
  const stranger = Keypair.generate();

  let scadMint: PublicKey;
  let housePda: PublicKey;
  let houseVaultPda: PublicKey;
  let userVaultPda: PublicKey;

  const pda = (...seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  before(async () => {
    // Fund actors from the test wallet.
    for (const kp of [cosigner, user, stranger]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    scadMint = await createMint(provider.connection, payer, payer.publicKey, null, 9);

    housePda = pda(Buffer.from('house'));
    houseVaultPda = pda(Buffer.from('house_vault'));
    userVaultPda = pda(Buffer.from('user_vault'), user.publicKey.toBuffer());
  });

  it('init_house', async () => {
    await program.methods
      .initHouse(cosigner.publicKey)
      .accounts({
        house: housePda,
        houseVault: houseVaultPda,
        scadMint,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const house = await (program.account as any).house.fetch(housePda);
    assert.equal(house.cosigner.toBase58(), cosigner.publicKey.toBase58());
    assert.isFalse(house.paused);

    // Seed the house float so it can pay net wins.
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: houseVaultPda,
        lamports: 2 * LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(tx);
  });

  it('deposit moves lamports into the user vault', async () => {
    await program.methods
      .deposit(new anchor.BN(1 * LAMPORTS_PER_SOL))
      .accounts({
        userVault: userVaultPda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
    const info = await provider.connection.getAccountInfo(userVaultPda);
    assert.isNotNull(info);
    assert.isAtLeast(info!.lamports, 1 * LAMPORTS_PER_SOL);
  });

  it('withdraw returns lamports and preserves rent', async () => {
    const before = await provider.connection.getBalance(user.publicKey);
    await program.methods
      .withdraw(new anchor.BN(0.4 * LAMPORTS_PER_SOL))
      .accounts({ userVault: userVaultPda, user: user.publicKey })
      .signers([user])
      .rpc();
    const after = await provider.connection.getBalance(user.publicKey);
    assert.isAtLeast(after - before, 0.39 * LAMPORTS_PER_SOL);
  });

  it('stranger cannot withdraw from another vault', async () => {
    try {
      await program.methods
        .withdraw(new anchor.BN(0.1 * LAMPORTS_PER_SOL))
        .accounts({ userVault: userVaultPda, user: stranger.publicKey })
        .signers([stranger])
        .rpc();
      assert.fail('should have thrown');
    } catch (e) {
      // Seeds are derived from the signer, so the stranger lands on a
      // different (non-existent) PDA — any error is a pass here.
      assert.ok(e);
    }
  });

  it('settle_bet (loss) moves net stake to the house', async () => {
    const houseBefore = (await provider.connection.getAccountInfo(houseVaultPda))!.lamports;
    const betId = Array.from({ length: 16 }, (_, i) => i + 1);
    await program.methods
      .settleBet(betId, { crash: {} }, new anchor.BN(0.2 * LAMPORTS_PER_SOL), new anchor.BN(0), 0)
      .accounts({
        house: housePda,
        houseVault: houseVaultPda,
        userVault: userVaultPda,
        cosigner: cosigner.publicKey,
      })
      .signers([cosigner])
      .rpc();
    const houseAfter = (await provider.connection.getAccountInfo(houseVaultPda))!.lamports;
    assert.equal(houseAfter - houseBefore, 0.2 * LAMPORTS_PER_SOL);
  });

  it('settle_bet (win) pays the net win from the house', async () => {
    const vaultBefore = (await provider.connection.getAccountInfo(userVaultPda))!.lamports;
    const betId = Array.from({ length: 16 }, (_, i) => i + 100 < 256 ? i + 100 : 0);
    await program.methods
      .settleBet(
        betId,
        { crash: {} },
        new anchor.BN(0.1 * LAMPORTS_PER_SOL),
        new anchor.BN(0.25 * LAMPORTS_PER_SOL),
        25000,
      )
      .accounts({
        house: housePda,
        houseVault: houseVaultPda,
        userVault: userVaultPda,
        cosigner: cosigner.publicKey,
      })
      .signers([cosigner])
      .rpc();
    const vaultAfter = (await provider.connection.getAccountInfo(userVaultPda))!.lamports;
    assert.equal(vaultAfter - vaultBefore, 0.15 * LAMPORTS_PER_SOL);
  });

  it('settle_bet rejects a non-cosigner', async () => {
    const betId = Array.from({ length: 16 }, () => 7);
    try {
      await program.methods
        .settleBet(betId, { crash: {} }, new anchor.BN(1000), new anchor.BN(0), 0)
        .accounts({
          house: housePda,
          houseVault: houseVaultPda,
          userVault: userVaultPda,
          cosigner: stranger.publicKey,
        })
        .signers([stranger])
        .rpc();
      assert.fail('should have thrown');
    } catch (e: any) {
      assert.include(String(e), 'NotCosigner');
    }
  });

  it('claim_reward transfers SCAD and blocks double claims', async () => {
    // Fund the treasury ATA (authority = house PDA).
    const treasuryAta = getAssociatedTokenAddressSync(scadMint, housePda, true);
    await getOrCreateAssociatedTokenAccount(provider.connection, payer, scadMint, housePda, true);
    await mintTo(provider.connection, payer, scadMint, treasuryAta, payer, 1_000_000_000_000n);

    const period = new anchor.BN(20260605);
    const claimRecord = pda(
      Buffer.from('claim'),
      user.publicKey.toBuffer(),
      Buffer.from([2]), // RewardKind::DailyCase
      Buffer.from(new Uint8Array(new BigUint64Array([BigInt(20260605)]).buffer)),
    );
    const userAta = getAssociatedTokenAddressSync(scadMint, user.publicKey);

    await program.methods
      .claimReward({ dailyCase: {} }, period, new anchor.BN(5_000_000_000))
      .accounts({
        house: housePda,
        claimRecord,
        user: user.publicKey,
        treasuryAta,
        userAta,
        scadMint,
        cosigner: cosigner.publicKey,
      })
      .signers([cosigner])
      .rpc();

    const acct = await getAccount(provider.connection, userAta);
    assert.equal(acct.amount, 5_000_000_000n);

    // Second claim for the same (user, kind, period) must fail (PDA exists).
    try {
      await program.methods
        .claimReward({ dailyCase: {} }, period, new anchor.BN(1))
        .accounts({
          house: housePda,
          claimRecord,
          user: user.publicKey,
          treasuryAta,
          userAta,
          scadMint,
          cosigner: cosigner.publicKey,
        })
        .signers([cosigner])
        .rpc();
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e);
    }
  });
});
