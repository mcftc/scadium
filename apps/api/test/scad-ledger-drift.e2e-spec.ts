import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SCAD } from '@scadium/shared';
import { prisma, makeUser, realPow } from './engine-harness';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * #229 — `accrue()` credits the REDEEMABLE $SCAD through `applyBalanceDelta`, so
 * every wager-reward credit writes a `scad` BalanceLedger row whose
 * `balanceAfter` equals `User.scadiumBalance`. Before the fix accrue did a raw
 * `scadiumBalance += amount` with no ledger row, leaving the `scad` ledger with
 * stake-path debits but no matching credits — unreconcilable.
 *
 * Proves: (a) accrue writes a `scad` ledger row matching the live balance, and
 * (b) the new `scadLedgerDrift()` reconcile arm flags ZERO for a clean
 * wager+accrue but FLAGS a deliberately-corrupted scadiumBalance.
 */
const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);
const pow = realPow();

describe('#229 — accrue() ledgers $SCAD (scadLedgerDrift reconcile arm)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accrue writes a scad BalanceLedger row whose balanceAfter == scadiumBalance', async () => {
    const u = await makeUser(0n);
    const betId = randomUUID();
    const stake = 2_000_000n; // 0.002 SOL

    const amount = await prisma.$transaction((tx) =>
      pow.accrue(tx, { userId: u.id, gameType: 'crash', stakeLamports: stake, betId }),
    );
    expect(amount).toBe(stake * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT)); // tier 0, no campaign

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.scadiumBalance).toBe(amount);

    const ledger = await prisma.balanceLedger.findFirst({
      where: { userId: u.id, currency: 'scad' },
      orderBy: { createdAt: 'desc' },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.delta).toBe(amount);
    expect(ledger!.balanceAfter).toBe(after.scadiumBalance);
    expect(ledger!.reason).toBe('wager_reward');
    expect(ledger!.refType).toBe('Bet');
    expect(ledger!.refId).toBe(betId);
  });

  it('scadLedgerDrift() flags ZERO after a clean wager+accrue', async () => {
    const u = await makeUser(0n);
    // Two accruals — the latest balanceAfter must still equal the live balance.
    await prisma.$transaction((tx) =>
      pow.accrue(tx, { userId: u.id, gameType: 'crash', stakeLamports: 1_000_000n }),
    );
    await prisma.$transaction((tx) =>
      pow.accrue(tx, { userId: u.id, gameType: 'dice', stakeLamports: 3_000_000n }),
    );

    await prisma.reconciliationDrift.deleteMany({ where: { userId: u.id } });
    await reconciliation.scadLedgerDrift();
    const flagged = await prisma.reconciliationDrift.count({
      where: { userId: u.id, field: 'scadiumBalance' },
    });
    expect(flagged).toBe(0);
  });

  it('scadLedgerDrift() FLAGS a directly-corrupted scadiumBalance', async () => {
    const u = await makeUser(0n);
    await prisma.$transaction((tx) =>
      pow.accrue(tx, { userId: u.id, gameType: 'crash', stakeLamports: 1_000_000n }),
    );
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
