import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, makeUser } from './engine-harness';

/**
 * #222 — DB last-line backstop: `usdsBalance`, `scadiumReserved`, and
 * `usdsReserved` must never persist a negative value (matching the existing
 * playBalanceLamports / scadiumBalance CHECKs). A bypassed application guard on
 * the reservation paths must be caught by the database. Asserts each new CHECK
 * rejects a negative write and a non-negative write still succeeds.
 */
describe('User reserved/USDS non-negative CHECK constraints (#222)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const columns = ['usdsBalance', 'scadiumReserved', 'usdsReserved'] as const;

  for (const col of columns) {
    it(`rejects a negative ${col}`, async () => {
      const u = await makeUser(0n);
      await expect(
        prisma.user.update({ where: { id: u.id }, data: { [col]: -1n } }),
      ).rejects.toThrow(); // Postgres CHECK violation (SQLSTATE 23514)
      // The row is untouched (constraint aborted the write).
      const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect((after as unknown as Record<string, bigint>)[col]).toBe(0n);
    });
  }

  it('allows non-negative reserved/USDS values', async () => {
    const u = await makeUser(0n);
    await prisma.user.update({
      where: { id: u.id },
      data: { usdsBalance: 5n, scadiumReserved: 3n, usdsReserved: 2n },
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.usdsBalance).toBe(5n);
    expect(after.scadiumReserved).toBe(3n);
    expect(after.usdsReserved).toBe(2n);
  });
});
