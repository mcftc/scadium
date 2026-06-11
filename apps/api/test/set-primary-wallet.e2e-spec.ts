import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { getPrisma } from './setup';
import { UsersService } from '../src/users/users.service';
import type { SiwsService } from '../src/auth/siws.service';

/**
 * #37 — setPrimaryWallet must assert ownership ATOMICALLY. The old code did
 * findUnique → check → $transaction with an UNSCOPED delete; a row unlinked or
 * re-owned between read and commit slipped through (TOCTOU). Now the delete is
 * scoped { address, userId } inside the transaction: 0 rows → abort, no
 * ownership mutation.
 */
describe('setPrimaryWallet atomic ownership (integration, real Postgres)', () => {
  const prisma = getPrisma();
  // SiwsService is only used by link flows — not by setPrimaryWallet.
  const users = new UsersService(prisma as never, {} as SiwsService);
  const RUN = Date.now().toString(36);
  let seq = 0;

  const makeUser = () => {
    seq += 1;
    return prisma.user.create({
      data: { walletAddress: `spw-${RUN}-${seq}`, refCode: `spw-ref-${RUN}-${seq}` },
    });
  };

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('happy path: promotes the linked wallet and demotes the old primary', async () => {
    const u = await makeUser();
    const linkedAddr = `spw-linked-${RUN}-${randomUUID().slice(0, 8)}`;
    await prisma.linkedWallet.create({ data: { userId: u.id, address: linkedAddr } });

    await users.setPrimaryWallet(u.id, linkedAddr);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.walletAddress).toBe(linkedAddr);
    const links = await prisma.linkedWallet.findMany({ where: { userId: u.id } });
    expect(links.map((l) => l.address)).toEqual([u.walletAddress]); // old primary demoted
  });

  it('TOCTOU: a row unlinked before the swap commits → error, ownership unchanged', async () => {
    const u = await makeUser();
    const linkedAddr = `spw-gone-${RUN}-${randomUUID().slice(0, 8)}`;
    await prisma.linkedWallet.create({ data: { userId: u.id, address: linkedAddr } });
    // Simulate the race: the link disappears after the request was formed.
    await prisma.linkedWallet.delete({ where: { address: linkedAddr } });

    await expect(users.setPrimaryWallet(u.id, linkedAddr)).rejects.toThrow(BadRequestException);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.walletAddress).toBe(u.walletAddress); // primary untouched
    // The aborted transaction must not have resurrected/demoted anything.
    expect(await prisma.linkedWallet.count({ where: { userId: u.id } })).toBe(0);
  });

  it("TOCTOU: a row RE-OWNED by another user → error, neither user's ownership corrupted", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const addr = `spw-stolen-${RUN}-${randomUUID().slice(0, 8)}`;
    // The row exists but belongs to B at commit time.
    await prisma.linkedWallet.create({ data: { userId: b.id, address: addr } });

    await expect(users.setPrimaryWallet(a.id, addr)).rejects.toThrow(BadRequestException);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).walletAddress).toBe(
      a.walletAddress,
    );
    // B's link is intact — the scoped delete cannot touch another user's row.
    const bLink = await prisma.linkedWallet.findUniqueOrThrow({ where: { address: addr } });
    expect(bLink.userId).toBe(b.id);
  });
});
