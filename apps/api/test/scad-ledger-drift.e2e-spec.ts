import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, makeUser } from './engine-harness';
import { applyBalanceDelta } from '../src/prisma/apply-balance-delta';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * #229 — every REDEEMABLE $SCAD credit flows through `applyBalanceDelta`, so it
 * writes a `scad` BalanceLedger row whose `balanceAfter` equals
 * `User.scadiumBalance`, making the live balance a re-derivable projection.
 * Under Engine v2 the credit path is the hourly block worker
 * (`reason: 'block_reward'`); this asserts the ledger row matches the live
 * balance and that the `scadLedgerDrift()` reconcile arm flags ZERO for a clean
 * credit but FLAGS a directly-corrupted scadiumBalance.
 */
const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);

/** Credit $SCAD exactly as BlockMiningService does (the single mint path). */
const mintScad = (userId: string, amount: bigint, refId = randomUUID()) =>
  prisma.$transaction((tx) =>
    applyBalanceDelta(tx, userId, amount, {
      currency: 'scad',
      reason: 'block_reward',
      refType: 'EngineBlock',
      refId,
    }),
  );

describe('#229 — $SCAD credits ledger cleanly (scadLedgerDrift reconcile arm)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a block-reward credit writes a scad BalanceLedger row whose balanceAfter == scadiumBalance', async () => {
    const u = await makeUser(0n);
    const refId = randomUUID();
    const amount = 256_000_000_000n; // arbitrary block share

    await mintScad(u.id, amount, refId);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.scadiumBalance).toBe(amount);

    const ledger = await prisma.balanceLedger.findFirst({
      where: { userId: u.id, currency: 'scad' },
      orderBy: { createdAt: 'desc' },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.delta).toBe(amount);
    expect(ledger!.balanceAfter).toBe(after.scadiumBalance);
    expect(ledger!.reason).toBe('block_reward');
    expect(ledger!.refType).toBe('EngineBlock');
    expect(ledger!.refId).toBe(refId);
  });

  it('scadLedgerDrift() flags ZERO after clean credits', async () => {
    const u = await makeUser(0n);
    // Two credits — the latest balanceAfter must still equal the live balance.
    await mintScad(u.id, 1_000_000_000n);
    await mintScad(u.id, 3_000_000_000n);

    await prisma.reconciliationDrift.deleteMany({ where: { userId: u.id } });
    await reconciliation.scadLedgerDrift();
    const flagged = await prisma.reconciliationDrift.count({
      where: { userId: u.id, field: 'scadiumBalance' },
    });
    expect(flagged).toBe(0);
  });

  it('scadLedgerDrift() FLAGS a directly-corrupted scadiumBalance', async () => {
    const u = await makeUser(0n);
    await mintScad(u.id, 1_000_000_000n);
    // Direct (non-ledgered) write — exactly the tampering the reconciler catches.
    await prisma.user.update({
      where: { id: u.id },
      data: { scadiumBalance: { increment: 999_999n } },
    });

    await prisma.reconciliationDrift.deleteMany({ where: { userId: u.id } });
    await reconciliation.scadLedgerDrift();
    const drift = await prisma.reconciliationDrift.findFirst({
      where: { userId: u.id, field: 'scadiumBalance' },
    });
    expect(drift).not.toBeNull();
    const live = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(drift!.storedValue).toBe(live.scadiumBalance.toString());
    expect(drift!.derivedValue).not.toBe(drift!.storedValue);
  });
});
