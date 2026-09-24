import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { prisma, makeUser } from './engine-harness';
import { custodyRig } from './custody-harness';

/**
 * Custody deposits (ADR 0005, spec §6.1), real Postgres + an in-memory ledger:
 * a verified transfer to the treasury becomes balance exactly once; what cannot
 * be credited yet is held with a reason and retried; the first credit converts
 * a play-money account and forfeits everything earned with play money.
 */

const SOL = 1_000_000_000n;
const balance = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).playBalanceLamports;

describe('custody deposits (integration, real Postgres)', () => {
  let rig: Awaited<ReturnType<typeof custodyRig>>;
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterEach(() => rig?.restore());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('credits a verified deposit once, and the first one converts the account', async () => {
    rig = await custodyRig();
    const referrer = await makeUser(10n * SOL); // play seed: forfeited on conversion
    const referee = await makeUser(0n);
    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        refereeId: referee.id,
        commissionLamports: 7_000n, // earned with play money, unclaimed
        commissionClaimedLamports: 2_000n,
      },
    });
    await prisma.user.update({
      where: { id: referrer.id },
      data: { totalWagered: 5n * SOL }, // five earned free lottery tickets
    });

    const sig = rig.chain.deposit(referrer.walletAddress, 2n * SOL);
    const row = await rig.deposits.confirm(sig);
    expect(row).toMatchObject({ status: 'credited', userId: referrer.id, amountLamports: 2n * SOL });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: referrer.id } });
    expect(after.playBalanceLamports).toBe(2n * SOL); // exactly the deposit
    expect(after.fundedAt).not.toBeNull();
    expect(after.freeTicketBaselineWagered).toBe(after.totalWagered); // no play-era free tickets
    const ref = await prisma.referral.findUniqueOrThrow({ where: { refereeId: referee.id } });
    expect(ref.commissionClaimedLamports).toBe(ref.commissionLamports); // nothing left to claim
    const reasons = (
      await prisma.balanceLedger.findMany({ where: { userId: referrer.id }, orderBy: { createdAt: 'asc' } })
    ).map((l) => [l.reason, l.delta]);
    expect(reasons).toEqual([
      ['custody_conversion', -10n * SOL],
      ['custody_deposit', 2n * SOL],
    ]);

    // Replays — by confirm or by scan — credit nothing more.
    await rig.deposits.confirm(sig);
    await rig.deposits.scan();
    expect(await balance(referrer.id)).toBe(2n * SOL);
    expect(await prisma.custodyTransfer.count({ where: { txSignature: sig } })).toBe(1);

    // A second deposit is a plain credit (no second conversion).
    await rig.deposits.confirm(rig.chain.deposit(referrer.walletAddress, SOL));
    expect(await balance(referrer.id)).toBe(3n * SOL);
  });

  it('pending until visible; a non-deposit signature is refused', async () => {
    rig = await custodyRig();
    expect(await rig.deposits.confirm('NotYetVisible1111111111111111111111111111111')).toEqual({
      status: 'pending',
    });
    rig.chain.txs.set('Outbound11111111111111111111111111111111111', { kind: 'outbound' });
    await expect(
      rig.deposits.confirm('Outbound11111111111111111111111111111111111'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an unknown sender is held, and credited once that wallet is linked', async () => {
    rig = await custodyRig();
    const u = await makeUser(0n);
    const wallet = `linked-${randomUUID()}`;
    const sig = rig.chain.deposit(wallet, SOL);
    expect(await rig.deposits.confirm(sig)).toMatchObject({ status: 'held', heldReason: 'unattributed' });

    await prisma.linkedWallet.create({ data: { userId: u.id, address: wallet } });
    await rig.deposits.scan(); // retries holds
    const row = await prisma.custodyTransfer.findUniqueOrThrow({ where: { txSignature: sig } });
    expect(row).toMatchObject({ status: 'credited', userId: u.id });
    expect(await balance(u.id)).toBe(SOL);
  });

  it('dust from an unknown wallet leaves no row; below-minimum from a user is held', async () => {
    rig = await custodyRig();
    const dust = rig.chain.deposit(`stranger-${randomUUID()}`, 5n);
    await expect(rig.deposits.confirm(dust)).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.custodyTransfer.count({ where: { txSignature: dust } })).toBe(0);

    const u = await makeUser(0n);
    const small = rig.chain.deposit(u.walletAddress, 5n);
    expect(await rig.deposits.confirm(small)).toMatchObject({ status: 'held', heldReason: 'below_minimum' });
    expect(await balance(u.id)).toBe(0n);
  });

  it('a daily deposit limit holds the deposit instead of crediting it', async () => {
    rig = await custodyRig();
    const u = await makeUser(0n);
    await prisma.user.update({ where: { id: u.id }, data: { dailyDepositLimitLamports: SOL } });
    await rig.deposits.confirm(rig.chain.deposit(u.walletAddress, SOL)); // exactly at the limit
    const over = rig.chain.deposit(u.walletAddress, 1n + SOL / 2n);
    expect(await rig.deposits.confirm(over)).toMatchObject({ status: 'held', heldReason: 'deposit_limit' });
    expect(await balance(u.id)).toBe(SOL);
  });

  it('conversion waits while play-money stakes are still riding', async () => {
    rig = await custodyRig();
    const u = await makeUser(5n * SOL);
    const flip = await prisma.coinflipGame.create({
      data: { creatorId: u.id, creatorSide: 'heads', amountLamports: SOL, status: 'open' },
    });
    const sig = rig.chain.deposit(u.walletAddress, SOL);
    expect(await rig.deposits.confirm(sig)).toMatchObject({
      status: 'held',
      heldReason: 'open_play_positions',
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).fundedAt).toBeNull();

    await prisma.coinflipGame.update({ where: { id: flip.id }, data: { status: 'cancelled' } });
    expect(await rig.deposits.retryHeld()).toBe(1);
    expect(await balance(u.id)).toBe(SOL);
  });

  it('the scan finds deposits the API never heard about, and moves its cursor', async () => {
    rig = await custodyRig();
    const [a, b] = [await makeUser(0n), await makeUser(0n)];
    rig.chain.deposit(a.walletAddress, SOL);
    rig.chain.deposit(b.walletAddress, 2n * SOL);
    expect(await rig.deposits.scan()).toEqual({ recorded: 2, credited: 2 });
    expect(await balance(a.id)).toBe(SOL);
    expect(await balance(b.id)).toBe(2n * SOL);
    const cursor = await prisma.scanCursor.findUniqueOrThrow({ where: { key: 'custody-treasury' } });
    expect(cursor.signature).toBe(rig.chain.history.at(-1)!.signature);

    rig.chain.deposit(a.walletAddress, SOL);
    expect(await rig.deposits.scan()).toEqual({ recorded: 1, credited: 1 });
    expect(await balance(a.id)).toBe(2n * SOL);
  });

  it('concurrent confirms of one signature credit it once', async () => {
    rig = await custodyRig();
    const u = await makeUser(0n);
    const sig = rig.chain.deposit(u.walletAddress, SOL);
    await Promise.allSettled(Array.from({ length: 8 }, () => rig.deposits.confirm(sig)));
    expect(await balance(u.id)).toBe(SOL);
    expect(await prisma.balanceLedger.count({ where: { userId: u.id, reason: 'custody_deposit' } })).toBe(1);
  });

  it('signed by wallets of two accounts: held for a human, never credited to either', async () => {
    rig = await custodyRig();
    const [payer, victim] = [await makeUser(0n), await makeUser(0n)];
    const sig = rig.chain.deposit(payer.walletAddress, SOL, [victim.walletAddress]);
    expect(await rig.deposits.confirm(sig)).toMatchObject({
      status: 'held',
      heldReason: 'ambiguous_sender',
      userId: null,
    });
    await rig.deposits.scan();
    expect(await rig.deposits.retryHeld()).toBe(0);
    expect(await balance(payer.id)).toBe(0n);
    expect(await balance(victim.id)).toBe(0n);
  });
});
