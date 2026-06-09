import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { applyBalanceDelta } from '../src/prisma/apply-balance-delta';
import { withSerializable } from '../src/prisma/with-serializable';

// TODO(harness #9): fold this bootstrap into the shared concurrency harness.
// Runs against a dedicated `scadium_test` DB so dev data is never clobbered.
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

// Debit exactly as production does post-#7: a guarded conditional debit + its
// ledger row, atomically. (applyBalanceDelta with a negative delta.)
function debit(userId: string, amount: bigint): Promise<bigint> {
  return withSerializable(prisma, (tx) =>
    applyBalanceDelta(tx, userId, -amount, { reason: 'test_debit', refType: 'test' }),
  );
}

const RUN = `${Date.now().toString(36)}`;
let seq = 0;
async function makeUser(balance: bigint) {
  seq += 1;
  return prisma.user.create({
    data: {
      walletAddress: `balrace-${RUN}-${seq}`,
      refCode: `balrace-ref-${RUN}-${seq}`,
      playBalanceLamports: balance,
    },
  });
}

describe('balance debit race (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('N concurrent debits on a one-bet balance: exactly one succeeds, balance lands on 0, never negative', async () => {
    const bet = 1_000_000n;
    const user = await makeUser(bet); // funded for exactly one bet
    const N = 20;

    const results = await Promise.allSettled(
      Array.from({ length: N }, () => debit(user.id, bet)),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejections = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));

    expect(fulfilled.length).toBe(1);
    expect(rejections.length).toBe(N - 1);

    // Every loser is rejected by the APP-LEVEL guard (count===0 →
    // BadRequestException), NOT by the DB CHECK firing on a would-be-negative
    // write. This isolates the conditional-debit fix from the CHECK backstop:
    // a naive read-then-decrement would let losers reach the decrement and be
    // killed by the CHECK instead (a Prisma error, not BadRequestException),
    // turning this assertion red.
    for (const reason of rejections) {
      expect(reason).toBeInstanceOf(BadRequestException);
    }

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(0n);
  });

  it('DB CHECK backstop rejects a direct negative-balance write', async () => {
    const user = await makeUser(5n);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "User" SET "playBalanceLamports" = -1 WHERE id = $1`, user.id),
    ).rejects.toThrow();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(5n);
  });

  it('happy path: a single debit decrements exactly; an over-debit rejects and leaves the balance untouched', async () => {
    const user = await makeUser(1_000n);

    await debit(user.id, 400n);
    let after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(600n);

    await expect(debit(user.id, 1_000n)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(600n);
  });
});
