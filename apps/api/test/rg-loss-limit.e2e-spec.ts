import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, makeUser } from './engine-harness';
import { RgService } from '../src/responsible-gambling/rg.service';

const rg = new RgService(
  prisma as never,
  { isPaused: async () => false } as never,
  { realMoneyEnabled: false } as never,
);

describe('rg daily loss limit (#46, integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a bet that would breach the daily loss limit before any debit', async () => {
    const u = await makeUser(0n);
    await rg.setLimits(u.id, { dailyLoss: 1_000_000_000n }); // 1 SOL daily loss limit
    // 0.9 SOL net loss already today (amount 0.9, payout 0).
    await prisma.bet.create({
      data: { userId: u.id, gameType: 'crash', amountLamports: 900_000_000n, payoutLamports: 0n },
    });

    // 0.9 + 0.2 = 1.1 SOL > 1.0 → rejected.
    await expect(rg.assertCanWager(u.id, 200_000_000n)).rejects.toThrow(/loss limit/i);
    // 0.9 + 0.05 = 0.95 SOL < 1.0 → allowed.
    await expect(rg.assertCanWager(u.id, 50_000_000n)).resolves.toBeUndefined();
  });
});
