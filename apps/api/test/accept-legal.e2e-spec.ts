import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LEGAL_VERSION } from '@scadium/shared';
import { prisma, makeUser } from './engine-harness';
import { UsersService } from '../src/users/users.service';
import type { SiwsService } from '../src/auth/siws.service';

// acceptLegal/findById touch only prisma; SiwsService is unused on this path.
const users = new UsersService(prisma as never, {} as SiwsService);

describe('accept-legal (#48, integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('stamps the current LEGAL_VERSION + timestamp and surfaces on GET /me', async () => {
    const u = await makeUser(0n);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(before.acceptedLegalVersion).toBeNull();
    expect(before.acceptedLegalAt).toBeNull();

    const me = await users.acceptLegal(u.id);
    expect(me.acceptedLegalVersion).toBe(LEGAL_VERSION);
    expect(me.acceptedLegalAt).not.toBeNull();

    const after = await users.findById(u.id);
    expect(after.acceptedLegalVersion).toBe(LEGAL_VERSION);
    expect(after.acceptedLegalAt).toBe(me.acceptedLegalAt);
  });

  it('re-accepting refreshes the timestamp (records the latest acceptance)', async () => {
    const u = await makeUser(0n);
    const first = await users.acceptLegal(u.id);
    await new Promise((r) => setTimeout(r, 15));
    const second = await users.acceptLegal(u.id);
    expect(second.acceptedLegalVersion).toBe(LEGAL_VERSION);
    expect(second.acceptedLegalAt).not.toBe(first.acceptedLegalAt); // re-stamped
  });
});
