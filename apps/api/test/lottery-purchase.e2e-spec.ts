import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LOTTERY, bulkDiscountTotal, scadBaseToLamports } from '@scadium/shared';
import { LotteryService } from '../src/games/lottery/lottery.service';
import { prisma, makeUser, makeLotteryEngine, offChain } from './engine-harness';

/**
 * Lottery purchases (four-games hardening C3 + B5), against real Postgres: a
 * batch is charged ONCE at the advertised bulk price, and an earned free ticket
 * can be spent exactly once no matter how many requests race for it.
 */

const rgStub = { assertCanWager: async () => undefined } as never;

describe('lottery purchases (integration, real Postgres)', () => {
  const engine = makeLotteryEngine();
  const svc = new LotteryService(prisma as never, engine, offChain, rgStub);

  beforeAll(async () => {
    await prisma.$connect();
    // A live draw to buy into (drawAt is the next scheduled draw — hours away).
    await prisma.lotteryDraw.updateMany({ where: { status: 'open' }, data: { status: 'drawn' } });
    await (engine as unknown as { openNewDraw: () => Promise<void> }).openNewDraw();
  });
  afterAll(async () => {
    await engine.onModuleDestroy();
    await prisma.$disconnect();
  });

  it('a 50-ticket batch is one debit at the bulk price — what the button advertised', async () => {
    const n = 50;
    const unit = engine.ticketPriceScadBase();
    const bulkScad = bulkDiscountTotal(unit, n);
    const perTicketScad = bulkScad / BigInt(n);
    const expectedDebit = scadBaseToLamports(perTicketScad) * BigInt(n);
    // The discount is real: the batch costs less than n singles.
    expect(expectedDebit).toBeLessThan(scadBaseToLamports(unit) * BigInt(n));

    const start = expectedDebit + 1_000n;
    const u = await makeUser(start);
    const picks = Array.from({ length: n }, (_, i) => [i % 10, 1, 2, 3, 4, (i * 7) % 10]);
    const res = await svc.buyTickets({ userId: u.id, picks });

    expect(res.count).toBe(n);
    expect(res.totalLamports).toBe(expectedDebit.toString());
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.playBalanceLamports).toBe(start - expectedDebit);
    // ONE ledger debit for the whole batch.
    expect(
      await prisma.balanceLedger.count({ where: { userId: u.id, reason: 'lottery_ticket' } }),
    ).toBe(1);
    const tickets = await prisma.lotteryTicket.findMany({ where: { userId: u.id } });
    expect(tickets).toHaveLength(n);
    // The tickets' recorded costs add up to exactly what was debited.
    expect(tickets.reduce((s, t) => s + t.costLamports, 0n)).toBe(expectedDebit);
  });

  it('rejects an oversized batch and a malformed pick, taking nothing', async () => {
    const u = await makeUser(10n ** 12n);
    const tooMany = Array.from({ length: LOTTERY.MAX_TICKETS_PER_PURCHASE + 1 }, () => [
      1, 2, 3, 4, 5, 6,
    ]);
    await expect(svc.buyTickets({ userId: u.id, picks: tooMany })).rejects.toThrow(/between/);
    await expect(
      svc.buyTickets({ userId: u.id, picks: [[1, 2, 3, 4, 5, 6], [1, 2, 3]] }),
    ).rejects.toThrow(/6 digits/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(
      10n ** 12n,
    );
  });

  it('one earned free ticket is redeemed exactly once under 20 parallel requests (B5)', async () => {
    const u = await makeUser(0n);
    // Exactly one free ticket earned (1 SOL of lifetime wager).
    await prisma.user.update({
      where: { id: u.id },
      data: { totalWagered: BigInt(LOTTERY.FREE_TICKET_PER_WAGER_LAMPORTS) },
    });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        svc.useFreeTicket({ userId: u.id, digits: [9, 9, 9, 9, 9, 9] }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.lotteryTicket.count({ where: { userId: u.id, free: true } })).toBe(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.freeTicketBaselineWagered).toBe(BigInt(LOTTERY.FREE_TICKET_PER_WAGER_LAMPORTS));
  });
});
