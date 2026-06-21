import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { VAULT } from '@scadium/shared';
import { VaultService } from '../src/vault/vault.service';
import { prisma } from './engine-harness';

/**
 * SCAD Vault term-staking (V4) integration against real Postgres. Proves the
 * deposit/withdraw money path: scad ↔ scad_vault moves are atomic + ledgered,
 * shares mint at the pool index, early withdrawal is penalised with the penalty
 * left in the pool (raising the index for holders), and the per-user balances
 * conserve (no drift). The seeded scad term pools (V3) are reset before each
 * test so the share index starts at genesis.
 */
describe('SCAD Vault — term staking (V4)', () => {
  const vault = new VaultService(prisma as never);
  const userIds: string[] = [];

  async function makeUser(scadBalance: bigint): Promise<string> {
    const id = randomUUID();
    const u = await prisma.user.create({
      data: {
        walletAddress: `vault-${id}`,
        refCode: `vault-ref-${id}`,
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

  async function user(id: string) {
    return prisma.user.findUniqueOrThrow({ where: { id } });
  }

  // Vault tables are used by this suite alone — wipe them and reset the seeded
  // pools to genesis before each test so the share index is deterministic.
  beforeEach(async () => {
    userIds.length = 0;
    await prisma.vaultEvent.deleteMany({});
    await prisma.vaultPosition.deleteMany({});
    await prisma.vaultPool.updateMany({
      data: { totalAssets: 0n, totalShares: 0n, indexRay: VAULT.INITIAL_INDEX_RAY, aprBps: 0 },
    });
  });

  afterAll(async () => {
    await prisma.vaultEvent.deleteMany({});
    await prisma.vaultPosition.deleteMany({});
    await prisma.balanceLedger.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vaultPool.updateMany({
      data: { totalAssets: 0n, totalShares: 0n, indexRay: VAULT.INITIAL_INDEX_RAY, aprBps: 0 },
    });
  });

  it('deposits $SCAD: spendable → vault, mints 1:1 shares at genesis', async () => {
    const amount = 100_000_000_000n; // 100 SCAD
    const userId = await makeUser(amount);
    const pid = await poolId(30);

    const res = await vault.deposit(userId, pid, amount);
    expect(res.shares).toBe(amount.toString()); // index = RAY → 1:1

    const u = await user(userId);
    expect(u.scadiumBalance).toBe(0n); // debited from spendable
    expect(u.scadiumVault).toBe(amount); // credited to the vault aggregate

    const pool = await prisma.vaultPool.findUniqueOrThrow({ where: { id: pid } });
    expect(pool.totalShares).toBe(amount);
    expect(pool.totalAssets).toBe(amount);

    const events = await prisma.vaultEvent.count({ where: { userId, kind: 'deposit' } });
    expect(events).toBe(1);
  });

  it('rejects a deposit above the spendable balance (atomic, no position)', async () => {
    const userId = await makeUser(10_000_000_000n); // 10 SCAD
    const pid = await poolId(30);
    await expect(vault.deposit(userId, pid, 100_000_000_000n)).rejects.toThrow(/insufficient/i);

    const u = await user(userId);
    expect(u.scadiumBalance).toBe(10_000_000_000n); // untouched
    expect(u.scadiumVault).toBe(0n);
    expect(await prisma.vaultPosition.count({ where: { userId } })).toBe(0);
  });

  it('rejects a deposit below the minimum', async () => {
    const userId = await makeUser(100_000_000_000n);
    const pid = await poolId(30);
    await expect(
      vault.deposit(userId, pid, BigInt(VAULT.MIN_DEPOSIT_SCAD_BASE) - 1n),
    ).rejects.toThrow(/minimum/i);
  });

  it('withdraws at maturity with NO penalty (full principal returned)', async () => {
    const amount = 100_000_000_000n;
    const userId = await makeUser(amount);
    const pid = await poolId(30);
    const { positionId } = await vault.deposit(userId, pid, amount);

    // Fast-forward maturity.
    await prisma.vaultPosition.update({
      where: { id: positionId },
      data: { maturesAt: new Date(Date.now() - 1000) },
    });

    const res = await vault.withdraw(userId, positionId);
    expect(res.early).toBe(false);
    expect(res.penaltyAssets).toBe('0');
    expect(res.netAssets).toBe(amount.toString());

    const u = await user(userId);
    expect(u.scadiumBalance).toBe(amount); // full principal back to spendable
    expect(u.scadiumVault).toBe(0n);
    expect(await prisma.vaultPosition.count({ where: { id: positionId } })).toBe(0);
  });

  it('charges the early-exit penalty and leaves it in the pool (raises the index)', async () => {
    const amount = 100_000_000_000n; // 100 SCAD each
    const alice = await makeUser(amount);
    const bob = await makeUser(amount);
    const pid = await poolId(30);

    const a = await vault.deposit(alice, pid, amount);
    await vault.deposit(bob, pid, amount);

    // Alice exits early (term not elapsed) → 10% penalty stays in the pool.
    const res = await vault.withdraw(alice, a.positionId);
    expect(res.early).toBe(true);
    const expectedPenalty = (amount * BigInt(VAULT.EARLY_EXIT_PENALTY_BPS)) / 10_000n;
    expect(res.penaltyAssets).toBe(expectedPenalty.toString());
    expect(res.netAssets).toBe((amount - expectedPenalty).toString());

    const ua = await user(alice);
    expect(ua.scadiumBalance).toBe(amount - expectedPenalty); // net back
    expect(ua.scadiumVault).toBe(0n);

    // Bob (still staked) now owns more than his principal — the penalty raised
    // the index in his favour.
    const [bobPos] = await vault.positions(bob);
    expect(BigInt(bobPos!.value)).toBeGreaterThan(amount);
    expect(BigInt(bobPos!.earned)).toBe(expectedPenalty); // exactly the penalty
  });

  it('supports a partial withdrawal', async () => {
    const amount = 100_000_000_000n;
    const userId = await makeUser(amount);
    const pid = await poolId(30);
    const { positionId } = await vault.deposit(userId, pid, amount);
    await prisma.vaultPosition.update({
      where: { id: positionId },
      data: { maturesAt: new Date(Date.now() - 1000) },
    });

    const half = amount / 2n;
    await vault.withdraw(userId, positionId, half); // withdraw half the shares

    const pos = await prisma.vaultPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(pos.shares).toBe(half);
    expect(pos.principal).toBe(half);

    const u = await user(userId);
    expect(u.scadiumBalance).toBe(half); // half returned
    expect(u.scadiumVault).toBe(half); // half still locked
  });

  it('keeps the ledger drift-free: scad + scad_vault conserved across a round-trip', async () => {
    const amount = 100_000_000_000n;
    const userId = await makeUser(amount);
    const pid = await poolId(90);
    const { positionId } = await vault.deposit(userId, pid, amount);
    await prisma.vaultPosition.update({
      where: { id: positionId },
      data: { maturesAt: new Date(Date.now() - 1000) },
    });
    await vault.withdraw(userId, positionId);

    // Net delta across BOTH currencies returns to zero (no mint/burn at maturity).
    const ledger = await prisma.balanceLedger.aggregate({
      where: { userId, currency: { in: ['scad', 'scad_vault'] } },
      _sum: { delta: true },
    });
    expect(ledger._sum.delta).toBe(0n);

    const u = await user(userId);
    expect(u.scadiumBalance).toBe(amount);
    expect(u.scadiumVault).toBe(0n);
  });

  it('serializes concurrent deposits into the same pool without corrupting totals', async () => {
    const amount = 50_000_000_000n;
    const pid = await poolId(180);
    const a = await makeUser(amount);
    const b = await makeUser(amount);
    const c = await makeUser(amount);

    await Promise.all([
      vault.deposit(a, pid, amount),
      vault.deposit(b, pid, amount),
      vault.deposit(c, pid, amount),
    ]);

    const pool = await prisma.vaultPool.findUniqueOrThrow({ where: { id: pid } });
    expect(pool.totalShares).toBe(amount * 3n);
    expect(pool.totalAssets).toBe(amount * 3n);
    expect(await prisma.vaultPosition.count({ where: { poolId: pid } })).toBe(3);
  });
});
