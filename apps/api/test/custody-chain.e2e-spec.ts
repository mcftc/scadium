import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { BadRequestException } from '@nestjs/common';
import { prisma } from './engine-harness';
import { Web3CustodyChain } from '../src/custody/custody-chain';
import { CustodyRuntime } from '../src/custody/custody-runtime';
import { DepositService } from '../src/custody/deposit.service';
import { WithdrawalService } from '../src/custody/withdrawal.service';
import { RgService } from '../src/responsible-gambling/rg.service';

/**
 * Custody against a REAL Solana validator (solana-test-validator; docker
 * compose service `solana`, CI service of the same name). The fake-ledger
 * suites prove the state machines; this one proves the web3.js seam reads the
 * chain the way they assume: balance deltas, signers, signature states, history.
 * Runs at `confirmed` so it takes seconds, not the ~13 s a finalized wait costs.
 */

const RPC = process.env.SOLANA_TEST_RPC ?? 'http://127.0.0.1:8899';
const SOL = BigInt(LAMPORTS_PER_SOL);
const ENV = ['CUSTODY_ENABLED', 'CUSTODY_HOT_WALLET_SECRET_KEY', 'CUSTODY_COMMITMENT', 'SOLANA_NETWORK', 'SOLANA_RPC_URL'];

describe('custody on a real Solana validator (integration)', () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const connection = new Connection(RPC, 'confirmed');
  const hot = Keypair.generate();
  const treasury = hot.publicKey.toBase58();
  let deposits: DepositService;
  let withdrawals: WithdrawalService;
  let chain: Web3CustodyChain;

  async function airdrop(to: PublicKey, sol: number) {
    const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
  }

  /** A player with a real wallet: an account row + a funded keypair. */
  async function player(sol = 5) {
    const kp = Keypair.generate();
    await airdrop(kp.publicKey, sol);
    const user = await prisma.user.create({
      data: {
        walletAddress: kp.publicKey.toBase58(),
        refCode: `chain-${randomUUID()}`,
        playBalanceLamports: 10n * SOL,
      },
    });
    return { kp, user };
  }

  const send = (from: Keypair, lamports: bigint) =>
    sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: hot.publicKey, lamports }),
      ),
      [from],
      { commitment: 'confirmed' },
    );

  beforeAll(async () => {
    try {
      await connection.getGenesisHash();
    } catch {
      throw new Error(
        `no Solana validator at ${RPC} — start it: docker compose -f infra/docker-compose.yml up -d solana`,
      );
    }
    await prisma.$connect();
    Object.assign(process.env, {
      CUSTODY_ENABLED: 'true',
      CUSTODY_HOT_WALLET_SECRET_KEY: bs58.encode(hot.secretKey),
      CUSTODY_COMMITMENT: 'confirmed',
      SOLANA_NETWORK: 'localnet',
      SOLANA_RPC_URL: RPC,
    });
    chain = new Web3CustodyChain(RPC, 'confirmed');
    const runtime = new CustodyRuntime(chain);
    expect((await runtime.prove())?.cluster).toBe('localnet'); // proven by genesis hash
    const notPaused = { isPaused: async () => false } as never;
    const rg = new RgService(prisma as never, notPaused, { realMoneyEnabled: false } as never);
    deposits = new DepositService(prisma as never, runtime, rg);
    withdrawals = new WithdrawalService(prisma as never, runtime, notPaused);
    await prisma.custodyTransfer.deleteMany({});
    await prisma.scanCursor.deleteMany({});
    await airdrop(hot.publicKey, 20); // the house float
  }, 60_000);

  afterAll(async () => {
    withdrawals?.onModuleDestroy();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await prisma.$disconnect();
  });

  it('a real transfer to the treasury is credited, and converts the account', async () => {
    const { kp, user } = await player();
    const sig = await send(kp, SOL);
    const row = await deposits.confirm(sig);
    expect(row).toMatchObject({ status: 'credited', userId: user.id, amountLamports: SOL });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(SOL);
    expect(after.fundedAt).not.toBeNull();
  }, 60_000);

  it('the scan credits a deposit nobody confirmed, and walks past our own withdrawals', async () => {
    const { kp, user } = await player();
    await send(kp, 2n * SOL); // the tab closed before POST /custody/deposits
    const r = await deposits.scan();
    expect(r.credited).toBeGreaterThanOrEqual(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).playBalanceLamports).toBe(
      2n * SOL,
    );
    // The history is now behind the cursor: a rescan records nothing new.
    expect((await deposits.scan()).recorded).toBe(0);
  }, 60_000);

  it('a withdrawal lands in the player’s wallet with its memo, confirmed on chain', async () => {
    const { kp, user } = await player(1);
    await deposits.confirm(await send(kp, SOL / 2n));
    const before = BigInt(await connection.getBalance(kp.publicKey, 'confirmed'));

    const view = await withdrawals.request(user.id, { amountLamports: SOL / 4n });
    const done = await withdrawals.drive(view.id, 60_000);
    expect(done.status).toBe('confirmed');
    const after = BigInt(await connection.getBalance(kp.publicKey, 'confirmed'));
    expect(after - before).toBe(SOL / 4n); // the treasury paid the fee, not the player

    const tx = await connection.getTransaction(done.txSignature!, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    expect(tx?.meta?.logMessages?.join('\n')).toContain(`scadium:w:${view.id}`);
    // The scanner classifies our own withdrawal as outbound — never a deposit.
    expect((await chain.treasuryTx(done.txSignature!, treasury)).kind).toBe('outbound');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).playBalanceLamports).toBe(
      SOL / 4n,
    );
  }, 90_000);

  it('a transfer that landed with an error is not a deposit', async () => {
    const { kp } = await player(1);
    // More than the wallet holds, past preflight: it lands, fails, moves nothing.
    const tx = new Transaction({
      feePayer: kp.publicKey,
      ...(await connection.getLatestBlockhash('confirmed')),
    }).add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: hot.publicKey, lamports: 50n * SOL }),
    );
    tx.sign(kp);
    const sig = bs58.encode(tx.signature!);
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    // Wait until it is visible, then check both seams.
    let state = await chain.signatureState(sig);
    for (let i = 0; i < 40 && !state.settled; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      state = await chain.signatureState(sig);
    }
    expect(state).toMatchObject({ found: true, failed: true, settled: true });
    await expect(deposits.confirm(sig)).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('an unbroadcast signature is unseen, and stays live until its blockhash expires', async () => {
    const signed = await chain.signTransfer(hot, Keypair.generate().publicKey.toBase58(), 1n, 'x');
    expect(await chain.signatureState(signed.signature)).toMatchObject({ found: false });
    // Not dead yet: the finalized height has not passed its expiry.
    expect(await chain.finalizedBlockHeight()).toBeLessThan(signed.lastValidBlockHeight);
  }, 30_000);
});
