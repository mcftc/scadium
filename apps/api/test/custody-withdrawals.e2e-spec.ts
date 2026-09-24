import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { prisma, makeUser } from './engine-harness';
import { custodyRig, fund } from './custody-harness';

/**
 * Custody withdrawals (ADR 0005, spec §6.2), real Postgres + an in-memory
 * ledger. The property under test is the one that matters: a withdrawal pays
 * at most once — a new signature only after the previous is provably dead, a
 * refund only on that same proof.
 */

const SOL = 1_000_000_000n;
const balance = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).playBalanceLamports;
const row = (id: string) => prisma.custodyTransfer.findUniqueOrThrow({ where: { id } });

describe('custody withdrawals (integration, real Postgres)', () => {
  let rig: Awaited<ReturnType<typeof custodyRig>>;
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterEach(() => rig?.restore());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function funded(lamports: bigint) {
    const u = await makeUser(0n);
    await fund(u.id, lamports);
    return u;
  }

  it('debits, signs, stores the signature, then confirms — to the user’s own wallet', async () => {
    rig = await custodyRig();
    const u = await funded(3n * SOL);
    const view = await rig.withdrawals.request(u.id, { amountLamports: SOL });
    expect(view.status).toBe('pending');
    expect(await balance(u.id)).toBe(2n * SOL);

    const done = await rig.withdrawals.drive(view.id, 5_000);
    expect(done.status).toBe('confirmed');
    expect(rig.chain.paidTo(u.walletAddress)).toBe(SOL);
    expect(rig.chain.sent.get(done.txSignature!)!.memo).toBe(`scadium:w:${view.id}`);
    expect(await balance(u.id)).toBe(2n * SOL);
    expect(
      await prisma.balanceLedger.count({ where: { userId: u.id, reason: 'custody_withdraw' } }),
    ).toBe(1);
  });

  it('only deposited funds, only to a linked wallet, within the limits', async () => {
    rig = await custodyRig();
    const play = await makeUser(10n * SOL);
    await expect(rig.withdrawals.request(play.id, { amountLamports: SOL })).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const u = await funded(100n * SOL);
    await expect(
      rig.withdrawals.request(u.id, { amountLamports: SOL, wallet: `someone-${randomUUID()}` }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(rig.withdrawals.request(u.id, { amountLamports: 1n })).rejects.toThrow(/minimum/);
    await expect(
      rig.withdrawals.request(u.id, { amountLamports: 11n * SOL }),
    ).rejects.toThrow(/maximum/);

    // A linked wallet is a valid destination.
    const linked = `linked-${randomUUID()}`;
    await prisma.linkedWallet.create({ data: { userId: u.id, address: linked } });
    const w = await rig.withdrawals.request(u.id, { amountLamports: SOL, wallet: linked });
    // One in flight at a time.
    await expect(rig.withdrawals.request(u.id, { amountLamports: SOL })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await rig.withdrawals.drive(w.id, 5_000);
    expect(rig.chain.paidTo(linked)).toBe(SOL);

    // Daily cap (25 SOL): 1 already out today.
    for (let i = 0; i < 2; i += 1) {
      const x = await rig.withdrawals.request(u.id, { amountLamports: 10n * SOL });
      await rig.withdrawals.drive(x.id, 5_000);
    }
    await expect(rig.withdrawals.request(u.id, { amountLamports: 5n * SOL })).rejects.toThrow(
      /Daily withdrawal limit/,
    );
    expect(await balance(u.id)).toBe(79n * SOL);
  });

  it('an Idempotency-Key replay returns the same withdrawal and debits once', async () => {
    rig = await custodyRig();
    rig.chain.fate = 'hang';
    const u = await funded(3n * SOL);
    const a = await rig.withdrawals.request(u.id, { amountLamports: SOL }, 'key-1');
    const b = await rig.withdrawals.request(u.id, { amountLamports: SOL }, 'key-1');
    expect(b.id).toBe(a.id);
    expect(await balance(u.id)).toBe(2n * SOL);
  });

  it('an unseen signature is re-signed only after its blockhash expired; one transfer lands', async () => {
    rig = await custodyRig();
    const u = await funded(3n * SOL);
    rig.chain.fate = 'drop';
    const view = await rig.withdrawals.request(u.id, { amountLamports: SOL });
    let r = await rig.withdrawals.drive(view.id, 0); // signed + broadcast, then dropped
    expect(r.status).toBe('sent');
    const first = r.txSignature!;

    // Not yet expired: still waiting on the SAME signature — no second one is
    // broadcast. (request() also drives it in the background, so a racing
    // processor may have SIGNED a spare; only the CAS winner ever broadcasts.)
    r = await rig.withdrawals.step(view.id);
    expect(r).toMatchObject({ status: 'sent', txSignature: first });
    expect(rig.chain.sent.size).toBe(1);

    rig.chain.finalizedHeight += 400n; // past lastValidBlockHeight + the expiry margin
    rig.chain.fate = 'land';
    r = await rig.withdrawals.step(view.id); // dead → back to pending
    expect(r).toMatchObject({ status: 'pending', txSignature: null });
    r = await rig.withdrawals.drive(view.id, 5_000);
    expect(r.status).toBe('confirmed');
    expect(r.txSignature).not.toBe(first);
    expect(rig.chain.paidTo(u.walletAddress)).toBe(SOL);
    expect(await balance(u.id)).toBe(2n * SOL);
  });

  it('a signature that landed with an error moved nothing — it is re-signed', async () => {
    rig = await custodyRig();
    const u = await funded(3n * SOL);
    rig.chain.fate = 'fail';
    const view = await rig.withdrawals.request(u.id, { amountLamports: SOL });
    await rig.withdrawals.drive(view.id, 0);
    rig.chain.fate = 'land';
    const r = await rig.withdrawals.drive(view.id, 5_000);
    expect(r.status).toBe('confirmed');
    expect(r.attempts).toBe(2);
    expect(rig.chain.paidTo(u.walletAddress)).toBe(SOL);
  });

  it('a failure that is not final yet is waited out, not treated as dead', async () => {
    rig = await custodyRig();
    const u = await funded(3n * SOL);
    rig.chain.fate = 'failing';
    const view = await rig.withdrawals.request(u.id, { amountLamports: SOL });
    let r = await rig.withdrawals.drive(view.id, 0);
    const first = r.txSignature!;
    rig.chain.finalizedHeight += 1_000n; // even long past expiry
    r = await rig.withdrawals.step(view.id);
    expect(r).toMatchObject({ status: 'sent', txSignature: first }); // still waiting
    expect(rig.chain.sent.size).toBe(1);

    rig.chain.sent.get(first)!.state.settled = true; // the failure is now final
    rig.chain.fate = 'land';
    r = await rig.withdrawals.drive(view.id, 5_000);
    expect(r.status).toBe('confirmed');
    expect(rig.chain.paidTo(u.walletAddress)).toBe(SOL);
  });

  it('after the last dead attempt the stake is refunded exactly once', async () => {
    rig = await custodyRig();
    process.env.CUSTODY_WITHDRAW_MAX_ATTEMPTS = '2';
    try {
      const u = await funded(3n * SOL);
      rig.chain.fate = 'fail';
      const view = await rig.withdrawals.request(u.id, { amountLamports: SOL });
      const r = await rig.withdrawals.drive(view.id, 5_000);
      expect(r.status).toBe('failed');
      expect(r.attempts).toBe(2);
      expect(rig.chain.paidTo(u.walletAddress)).toBe(0n);
      expect(await balance(u.id)).toBe(3n * SOL);
      // Driving the settled row again changes nothing.
      await rig.withdrawals.step(view.id);
      await rig.withdrawals.resumeAll();
      expect(
        await prisma.balanceLedger.count({
          where: { userId: u.id, reason: 'custody_withdraw_refund' },
        }),
      ).toBe(1);
      expect(await balance(u.id)).toBe(3n * SOL);
    } finally {
      delete process.env.CUSTODY_WITHDRAW_MAX_ATTEMPTS;
    }
  });

  it('waits (unsigned) while the hot wallet cannot cover it, then pays after a top-up', async () => {
    rig = await custodyRig({ hotLamports: SOL / 2n });
    const u = await funded(3n * SOL);
    const view = await rig.withdrawals.request(u.id, { amountLamports: SOL });
    const r = await rig.withdrawals.step(view.id);
    expect(r).toMatchObject({ status: 'pending', txSignature: null, attempts: 0 });
    expect(rig.chain.signed).toHaveLength(0); // nothing is even signed while short

    rig.chain.balances.set(rig.treasury, 5n * SOL);
    await rig.withdrawals.resumeAll(); // the job
    await rig.withdrawals.resumeAll();
    expect((await row(view.id)).status).toBe('confirmed');
  });

  it('racing processors never put two live signatures on one withdrawal', async () => {
    rig = await custodyRig();
    rig.chain.fate = 'hang';
    const u = await funded(3n * SOL);
    const view = await rig.withdrawals.request(u.id, { amountLamports: SOL });
    await Promise.all(Array.from({ length: 6 }, () => rig.withdrawals.step(view.id)));
    expect(rig.chain.sent.size).toBe(1); // signatures may be made, only one is broadcast
    const r = await row(view.id);
    expect(r.status).toBe('sent');
    expect(rig.chain.sent.has(r.txSignature!)).toBe(true);
  });

  it('the global pause signs nothing new, and holds deposits until it lifts', async () => {
    rig = await custodyRig();
    const u = await funded(3n * SOL);
    // A withdrawal queued before the pause (debited, not yet signed).
    const queued = await prisma.custodyTransfer.create({
      data: { kind: 'withdraw', status: 'pending', userId: u.id, wallet: u.walletAddress, amountLamports: SOL },
    });
    rig.maintenance.paused = true;
    await expect(rig.withdrawals.request(u.id, { amountLamports: SOL })).rejects.toThrow(/paused/);
    expect((await rig.withdrawals.step(queued.id)).status).toBe('pending');
    expect(rig.chain.signed).toHaveLength(0);
    const dep = rig.chain.deposit(u.walletAddress, SOL);
    expect(await rig.deposits.confirm(dep)).toMatchObject({ status: 'held', heldReason: 'paused' });

    rig.maintenance.paused = false;
    expect((await rig.withdrawals.drive(queued.id, 5_000)).status).toBe('confirmed');
    expect(await rig.deposits.retryHeld()).toBe(1);
  });
});
