import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  VAULT,
  vaultYieldSliceLamports,
  lamportsToScadBase,
  assetsForShares,
} from '@scadium/shared';
import { VaultService } from '../src/vault/vault.service';
import { VaultAccrualService } from '../src/vault/vault-accrual.service';
import { periodForHour } from '../src/queue/queue.constants';
import { prisma } from './engine-harness';

/**
 * SCAD Vault hourly yield accrual (V5) integration against real Postgres. Proves
 * the NGR → $SCAD yield path: the Vault slice is split across staked term pools
 * by weight, credited to the pool index (positions appreciate), the round is
 * idempotent per hour, and a no-yield hour settles to zero without moving an
 * index.
 */
describe('SCAD Vault — yield accrual (V5)', () => {
  const vault = new VaultService(prisma as never);
  const accrual = new VaultAccrualService(prisma as never);
  const userIds: string[] = [];

  // The accrual window is the hour containing (now − 60s); place NGR bets there.
  const period = periodForHour(Date.now() - 60_000);
  const windowStart = new Date(
    Date.parse(
      `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}T${period.slice(8, 10)}:00:00Z`,
    ),
  );
  const windowEnd = new Date(windowStart.getTime() + 3_600_000);

  async function makeUser(scadBalance: bigint): Promise<string> {
    const id = randomUUID();
    const u = await prisma.user.create({
      data: {
        walletAddress: `vault-acc-${id}`,
        refCode: `vault-acc-ref-${id}`,
        scadiumBalance: scadBalance,
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

  /** Create a losing bet in the accrual window → deterministic positive NGR. */
  async function makeNgr(lossLamports: bigint) {
    const better = await makeUser(0n);
    await prisma.bet.create({
      data: {
        userId: better,
        gameType: 'crash',
        amountLamports: lossLamports,
        payoutLamports: 0n,
        status: 'lost',
        createdAt: new Date(windowStart.getTime() + 5 * 60_000),
      },
    });
  }

  async function pool(id: string) {
    return prisma.vaultPool.findUniqueOrThrow({ where: { id } });
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

  it('credits the NGR yield slice to a staked pool index (sole pool gets it all)', async () => {
    const stake = 100_000_000_000n; // 100 SCAD
    const userId = await makeUser(stake);
    const pid = await poolId(30);
    await vault.deposit(userId, pid, stake);

    const ngrLamports = 1_000_000_000n; // 1 SOL-equivalent NGR
    await makeNgr(ngrLamports);
    const expectedYield = lamportsToScadBase(vaultYieldSliceLamports(ngrLamports));
    expect(expectedYield).toBeGreaterThan(0n);

    const res = await accrual.accrue();
    expect(res.yieldScad).toBe(expectedYield.toString());

    const p = await pool(pid);
    expect(p.indexRay).toBeGreaterThan(VAULT.INITIAL_INDEX_RAY); // index rose
    expect(p.totalAssets).toBe(stake + expectedYield);

    // The sole staker now owns principal + the whole yield.
    const value = assetsForShares(p.totalShares, p.indexRay);
    expect(value - stake).toBe(expectedYield);

    const round = await prisma.vaultAccrualRound.findUniqueOrThrow({ where: { period } });
    expect(round.distributed).toBe(true);
    expect(round.yieldScad).toBe(expectedYield);
  });

  it('is idempotent: re-running the same hour credits nothing twice', async () => {
    const stake = 100_000_000_000n;
    const userId = await makeUser(stake);
    const pid = await poolId(30);
    await vault.deposit(userId, pid, stake);
    await makeNgr(1_000_000_000n);

    await accrual.accrue();
    const after1 = await pool(pid);
    const res2 = await accrual.accrue();
    const after2 = await pool(pid);

    expect(res2.yieldScad).toBe('0'); // round already settled
    expect(after2.indexRay).toBe(after1.indexRay); // index unchanged
    expect(after2.totalAssets).toBe(after1.totalAssets);
  });

  it('splits yield across pools by weight × stake (longer term earns more)', async () => {
    const stake = 100_000_000_000n; // equal stake in both pools
    const a = await makeUser(stake);
    const b = await makeUser(stake);
    const p30 = await poolId(30); // weightBps 1000
    const p90 = await poolId(90); // weightBps 2000
    await vault.deposit(a, p30, stake);
    await vault.deposit(b, p90, stake);
    await makeNgr(1_000_000_000n);

    await accrual.accrue();

    const pool30 = await pool(p30);
    const pool90 = await pool(p90);
    const yield30 = pool30.totalAssets - stake;
    const yield90 = pool90.totalAssets - stake;
    // Equal stake → split is purely by weight: 90d (2000) gets ~2× the 30d
    // (1000). Allow ±1 base unit for integer-floor dust in the pro-rata split.
    expect(yield90).toBeGreaterThan(yield30);
    const diff = yield90 - yield30 * 2n;
    expect(diff >= -1n && diff <= 1n).toBe(true);
  });

  it('settles a no-yield hour to zero without moving an index', async () => {
    const stake = 100_000_000_000n;
    const userId = await makeUser(stake);
    const pid = await poolId(30);
    await vault.deposit(userId, pid, stake);
    // No NGR bets → zero yield.

    const res = await accrual.accrue();
    expect(res.yieldScad).toBe('0');

    const p = await pool(pid);
    expect(p.indexRay).toBe(VAULT.INITIAL_INDEX_RAY); // untouched
    const round = await prisma.vaultAccrualRound.findUniqueOrThrow({ where: { period } });
    expect(round.distributed).toBe(true); // settled (won't retry forever)
  });

  it('pays accrued yield out as $SCAD on a mature withdrawal', async () => {
    const stake = 100_000_000_000n;
    const userId = await makeUser(stake);
    const pid = await poolId(30);
    const { positionId } = await vault.deposit(userId, pid, stake);
    await makeNgr(1_000_000_000n);
    const expectedYield = lamportsToScadBase(vaultYieldSliceLamports(1_000_000_000n));
    await accrual.accrue();

    // Mature the position, then withdraw the whole thing.
    await prisma.vaultPosition.update({
      where: { id: positionId },
      data: { maturesAt: new Date(Date.now() - 1000) },
    });
    const res = await vault.withdraw(userId, positionId);
    expect(res.netAssets).toBe((stake + expectedYield).toString());

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.scadiumBalance).toBe(stake + expectedYield); // principal + yield as SCAD
    expect(u.scadiumVault).toBe(0n);
  });
});
