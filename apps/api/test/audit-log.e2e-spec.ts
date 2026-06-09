import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AdminService } from '../src/admin/admin.service';
import { AirdropEngine } from '../src/airdrop/airdrop.engine';

// TODO(harness #9): fold this bootstrap into the shared concurrency harness.
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
const admin = new AdminService(prisma as never);

const RUN = `${Date.now().toString(36)}`;
let seq = 0;
async function makeUser(role: 'user' | 'admin' = 'user') {
  seq += 1;
  return prisma.user.create({
    data: { walletAddress: `audit-${RUN}-${seq}`, refCode: `audit-ref-${RUN}-${seq}`, role },
  });
}

// periodFor mirrors AirdropEngine's (UTC YYYYMMDDHH).
function periodFor(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}

describe('audit log for privileged actions (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('banUser writes an AuditLog row (actor, action=ban, target) atomically', async () => {
    const actor = await makeUser('admin');
    const target = await makeUser();

    await admin.banUser(actor.id, target.id, 'spam');

    const rows = await prisma.auditLog.findMany({
      where: { actorUserId: actor.id, action: 'ban', targetUserId: target.id },
    });
    expect(rows.length).toBe(1);
    expect((rows[0]!.metadataJson as { reason?: string } | null)?.reason).toBe('spam');
    // The action itself applied in the same tx.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).banned).toBe(true);
  });

  it('unbanUser writes an AuditLog row (action=unban)', async () => {
    const actor = await makeUser('admin');
    const target = await makeUser();
    await admin.banUser(actor.id, target.id);
    await admin.unbanUser(actor.id, target.id);

    const rows = await prisma.auditLog.findMany({
      where: { actorUserId: actor.id, action: 'unban', targetUserId: target.id },
    });
    expect(rows.length).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).banned).toBe(false);
  });

  it('forced airdrop distribution writes a forced_airdrop AuditLog row', async () => {
    const actor = await makeUser('admin');
    const engine = new AirdropEngine(
      prisma as never,
      new Proxy({}, { get: () => () => undefined }) as never,
    );

    // Seed a fundable pool for the period distribute() will target; with no
    // eligible players it rolls over, and the forced run still records the
    // privileged action (atomic with the rollover).
    const period = periodFor(Date.now() - 60_000);
    await prisma.airdropPool.upsert({
      where: { period },
      update: { baseLamports: 1_000_000_000n, distributed: false },
      create: { period, baseLamports: 1_000_000_000n },
    });

    await engine.distribute(actor.id);

    const rows = await prisma.auditLog.findMany({
      where: { actorUserId: actor.id, action: 'forced_airdrop' },
    });
    expect(rows.length).toBe(1);
  });
});
