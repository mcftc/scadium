import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { VAULT, lamportsToScadBase, vaultYieldSliceLamports } from '@scadium/shared';
import { VaultService } from '../src/vault/vault.service';
import { VaultAccrualService } from '../src/vault/vault-accrual.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { periodForHour } from '../src/queue/queue.constants';
import { prisma } from './engine-harness';

/**
 * SCAD Vault end-to-end lifecycle (V8): deposit → accrue → withdraw (mature +
 * early) across two stakers, asserting the off-chain ledger invariants
 * (`vaultLedgerDrift() === 0`) hold at every step. This is the umbrella test
 * that proves V4 + V5 compose correctly. Chain is disabled (play-money).
 */
describe('SCAD Vault — lifecycle (V8)', () => {
  const vault = new VaultService(prisma as never);
  const accrual = new VaultAccrualService(prisma as never, { enabled: false } as never);
  const reconcile = new ReconciliationService(prisma as never, { enabled: false } as never);
  const userIds: string[] = [];

  const period = periodForHour(Date.now() - 60_000);
  const windowStart = new Date(
    Date.parse(
      `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}T${period.slice(8, 10)}:00:00Z`,
    ),
  );
  const windowEnd = new Date(windowStart.getTime() + 3_600_000);

  async function makeUser(scad: bigint): Promise<string> {
    const id = randomUUID();
    const u = await prisma.user.create({
      data: {
        walletAddress: `vault-lc-${id}`,
        refCode: `vault-lc-ref-${id}`,
        scadiumBalance: scad,
      },
    });
    userIds.push(u.id);
    return u.id;
  }
  async function poolId(termDays: number): Promise<string> {
    const p = await prisma.vaultPool.findUniqueOrThrow({
      where: { asset_termDays: { asset: 'scad', termDays } },
    });
    return p.id;
  }
  async function makeNgr(loss: bigint) {
    const u = await makeUser(0n);
    await prisma.bet.create({
      data: {
        userId: u,
        gameType: 'crash',
        amountLamports: loss,
        payoutLamports: 0n,
        status: 'lost',
        createdAt: new Date(windowStart.getTime() + 5 * 60_000),
      },
    });
  }

  beforeEach(async () => {
    userIds.length = 0;
    await prisma.vaultEvent.deleteMany({});
    await prisma.vaultPosition.deleteMany({});
    await prisma.vaultAccrualRound.deleteMany({ where: { period } });
    await prisma.bet.deleteMany({ where: { createdAt: { gte: windowStart, lt: windowEnd } } });
    await prisma.vaultPool.updateMany({
      data: { totalAssets: 0n, totalShares: 0n, indexRay: VAULT.INITIAL_INDEX_RAY, aprBps: 0 },
    });
    // vaultLedgerDrift() is a GLOBAL invariant check — establish a clean baseline
    // by zeroing any stray scadiumVault left by another suite (positions above
    // are already cleared), so the drift assertions reflect only this scenario.
    await prisma.user.updateMany({
      where: { scadiumVault: { gt: 0n } },
      data: { scadiumVault: 0n },
    });
  });

  afterAll(async () => {
    await prisma.vaultEvent.deleteMany({});
    await prisma.vaultPosition.deleteMany({});
    await prisma.vaultAccrualRound.deleteMany({ where: { period } });
    await prisma.bet.deleteMany({ where: { createdAt: { gte: windowStart, lt: windowEnd } } });
    await prisma.balanceLedger.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vaultPool.updateMany({
      data: { totalAssets: 0n, totalShares: 0n, indexRay: VAULT.INITIAL_INDEX_RAY, aprBps: 0 },
    });
  });

  it('deposit → accrue → mature + early withdraw, ledger drift zero throughout', async () => {
    const stake = 100_000_000_000n; // 100 SCAD each
    const alice = await makeUser(stake);
    const bob = await makeUser(stake);
    const pid = await poolId(30);

    const a = await vault.deposit(alice, pid, stake);
    const b = await vault.deposit(bob, pid, stake);
    expect(await reconcile.vaultLedgerDrift()).toBe(0);

    // Yield accrues to the pool index.
    await makeNgr(1_000_000_000n);
    const yieldScad = lamportsToScadBase(vaultYieldSliceLamports(1_000_000_000n));
    await accrual.accrue();
    expect(await reconcile.vaultLedgerDrift()).toBe(0);

    // Bob holds to maturity → principal + (his half of) the yield, no penalty.
    await prisma.vaultPosition.update({
      where: { id: b.positionId },
      data: { maturesAt: new Date(Date.now() - 1000) },
    });
    const bobOut = await vault.withdraw(bob, b.positionId);
    expect(bobOut.early).toBe(false);
    expect(BigInt(bobOut.netAssets)).toBeGreaterThan(stake); // earned yield
    expect(await reconcile.vaultLedgerDrift()).toBe(0);

    // Alice exits early → penalty kept in pool (she is now the only staker, so
    // the index rise from her own penalty has no one else to benefit).
    const aliceOut = await vault.withdraw(alice, a.positionId);
    expect(aliceOut.early).toBe(true);
    expect(BigInt(aliceOut.penaltyAssets)).toBeGreaterThan(0n);
    expect(await reconcile.vaultLedgerDrift()).toBe(0);

    // Pool fully unwound.
    const pool = await prisma.vaultPool.findUniqueOrThrow({ where: { id: pid } });
    expect(pool.totalShares).toBe(0n);

    // Both stakers' vault aggregates are back to zero.
    for (const id of [alice, bob]) {
      const u = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(u.scadiumVault).toBe(0n);
    }

    // Sanity: the round distributed exactly the computed yield slice.
    const round = await prisma.vaultAccrualRound.findUniqueOrThrow({ where: { period } });
    expect(round.yieldScad).toBe(yieldScad);
  });
});
