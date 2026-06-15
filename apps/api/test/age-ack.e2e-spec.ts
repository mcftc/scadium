import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, makeUser } from './engine-harness';
import { UsersService } from '../src/users/users.service';
import type { SiwsService } from '../src/auth/siws.service';

// ackAge/findById touch only prisma; SiwsService is unused on this path.
const users = new UsersService(prisma as never, {} as SiwsService);

describe('age-ack (#44, integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('stamps ageConfirmedAt on first ack and surfaces it on GET /me', async () => {
    const u = await makeUser(0n);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).ageConfirmedAt,
    ).toBeNull();

    const me = await users.ackAge(u.id);
    expect(me.ageConfirmedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).ageConfirmedAt).not.toBeNull();
    // The profile read reflects it too.
    expect((await users.findById(u.id)).ageConfirmedAt).toBe(me.ageConfirmedAt);
  });

  it('is idempotent — re-acking keeps the earliest timestamp', async () => {
    const u = await makeUser(0n);
    await users.ackAge(u.id);
    const first = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).ageConfirmedAt!;

    await new Promise((r) => setTimeout(r, 15));
    const me2 = await users.ackAge(u.id);

    expect(me2.ageConfirmedAt).toBe(first.toISOString());
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).ageConfirmedAt!.getTime(),
    ).toBe(first.getTime());
  });
});
