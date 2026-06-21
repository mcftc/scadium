import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { VAULT } from '@scadium/shared';
import { bootstrapApp, resetDb, seedUser, getPrisma, type BootstrapResult } from './setup';

/**
 * SCAD Vault REST API (V6) — HTTP integration over the real app + Postgres.
 * Proves the routes are wired, JwtAuthGuard protects them, DTO validation runs,
 * and deposit/positions round-trip through the service. The deposit/withdraw
 * money math itself is covered by the service-level suites (V4/V5).
 */
describe('SCAD Vault API (V6)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();

  beforeAll(async () => {
    harness = await bootstrapApp();
  });

  afterAll(async () => {
    // Leave the shared test DB clean for other vault suites: resetDb truncates
    // User CASCADE (clears VaultPositions + scadiumVault), then reset the pools.
    await resetDb(prisma);
    await prisma.vaultEvent.deleteMany({});
    await prisma.vaultPool.updateMany({
      data: { totalAssets: 0n, totalShares: 0n, indexRay: VAULT.INITIAL_INDEX_RAY, aprBps: 0 },
    });
    await harness.app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma); // truncates User CASCADE → also clears VaultPosition
    await prisma.vaultEvent.deleteMany({});
    await prisma.vaultPool.updateMany({
      data: { totalAssets: 0n, totalShares: 0n, indexRay: VAULT.INITIAL_INDEX_RAY, aprBps: 0 },
    });
  });

  /** A user funded with `scad` (vault deposits debit scadiumBalance). */
  async function fundedUser(scad: bigint) {
    const { user, token } = await seedUser(0n, harness.signToken, prisma);
    await prisma.user.update({ where: { id: user.id }, data: { scadiumBalance: scad } });
    return { user, token };
  }

  async function poolId(termDays: number): Promise<string> {
    const p = await prisma.vaultPool.findUniqueOrThrow({
      where: { asset_termDays: { asset: 'scad', termDays } },
    });
    return p.id;
  }

  it('requires auth: GET /api/v1/vault/positions is 401 without a token', async () => {
    const res = await request(harness.server).get('/api/v1/vault/positions');
    expect(res.status).toBe(401);
  });

  it('lists the seeded term pools publicly (no auth)', async () => {
    const res = await request(harness.server).get('/api/v1/vault/pools');
    expect(res.status).toBe(200);
    const terms = res.body.map((p: { termDays: number }) => p.termDays).sort((a, b) => a - b);
    expect(terms).toEqual([30, 90, 180, 365]);
  });

  it('deposits then reflects the position', async () => {
    const stake = 100_000_000_000n; // 100 SCAD
    const { token } = await fundedUser(stake);
    const pid = await poolId(30);

    const dep = await request(harness.server)
      .post('/api/v1/vault/deposit')
      .set('Authorization', `Bearer ${token}`)
      .send({ poolId: pid, amount: stake.toString() });
    expect(dep.status).toBe(201);
    expect(dep.body.shares).toBe(stake.toString()); // 1:1 at genesis

    const pos = await request(harness.server)
      .get('/api/v1/vault/positions')
      .set('Authorization', `Bearer ${token}`);
    expect(pos.status).toBe(200);
    expect(pos.body).toHaveLength(1);
    expect(pos.body[0].principal).toBe(stake.toString());
    expect(pos.body[0].termDays).toBe(30);
  });

  it('rejects a malformed deposit amount (DTO validation)', async () => {
    const { token } = await fundedUser(100_000_000_000n);
    const pid = await poolId(30);
    const res = await request(harness.server)
      .post('/api/v1/vault/deposit')
      .set('Authorization', `Bearer ${token}`)
      .send({ poolId: pid, amount: '-5' }); // fails the /^[1-9]\d*$/ DTO rule
    expect(res.status).toBe(400);
  });
});
