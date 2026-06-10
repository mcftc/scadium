import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomInt } from 'node:crypto';
import { ticketPriceScadBase } from '@scadium/shared';
import { prisma, makeUser, makeSeed, makeLotteryEngine } from './engine-harness';

/**
 * Issue #19a — when the chain is disabled the lottery settles from the
 * operator-deterministic synthetic slot hash. That draw must be recorded as
 * `synthetic-not-fair`, never presented as provably fair.
 */
describe('lottery synthetic draws flagged non-fair (issue #19a)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('chain disabled → settled draw is flagged synthetic-not-fair', async () => {
    const u = await makeUser(0n);
    const seed = await makeSeed();
    const drawIndex = BigInt(randomInt(1, 2_000_000_000));
    const draw = await prisma.lotteryDraw.create({
      data: { seedId: seed.id, nonce: 0, status: 'open', drawIndex, drawAt: new Date(Date.now() - 60_000) },
    });
    await prisma.lotteryTicket.create({
      data: {
        drawId: draw.id,
        userId: u.id,
        digits: [1, 2, 3, 4, 5, 6],
        costLamports: 0n,
        costScadBase: ticketPriceScadBase(),
      },
    });

    const engine = makeLotteryEngine();
    const e = engine as unknown as Record<string, unknown>;
    e.recovering = true; // suppress the chained openNewDraw at the end
    e.current = {
      id: draw.id,
      drawIndex,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      drawAt: Date.now(),
      status: 'open',
      ticketCount: 1,
      ticketPriceScadBase: ticketPriceScadBase(),
      injectionScadBase: 0n,
      rolloverScadBase: 0n,
      salesScadBase: 0n,
      potLamports: 0n,
      commitTxSignature: null,
    };

    await (engine as unknown as { drawAndSettle: () => Promise<void> }).drawAndSettle();

    const settled = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: draw.id } });
    expect(settled.status).toBe('drawn');
    expect(settled.fairness).toBe('synthetic-not-fair');
    expect(settled.slotHash).not.toBeNull();
  });
});
