import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma, TEST_DB_URL } from './engine-harness';
import { AirdropEngine } from '../src/airdrop/airdrop.engine';
import type { AirdropGateway } from '../src/airdrop/airdrop.gateway';
import type { RgService } from '../src/responsible-gambling/rg.service';
import { periodForHour } from '../src/queue/queue.constants';

/**
 * #216 — `AirdropEngine.distribute()` checked `pool.distributed` BEFORE the tx and
 * flipped it with an UNCONDITIONAL update inside, so two concurrent runs could both
 * pass the pre-check and double-distribute (balance mint) / double-roll-over. The
 * fix claims the pool with a guarded `updateMany({ where: { period, distributed:
 * false } })` inside the tx — only the run that flips it false→true proceeds.
 *
 * This exercises the simplest path — the no-eligible-users ROLLOVER (no bets/chat)
 * — and asserts the pool is rolled into the next hour EXACTLY ONCE under both a
 * sequential second call and a concurrent pair (each on its own connection).
 */
describe('airdrop distribute idempotency — #216', () => {
  const clients: PrismaClient[] = [];
  const gateway = {
    emitDropped: () => undefined,
    emitPool: () => undefined,
  } as unknown as AirdropGateway;
  const rg = {} as RgService;

  const engine = (client: PrismaClient = prisma as unknown as PrismaClient) =>
    new AirdropEngine(client as never, gateway, rg);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await Promise.allSettled(clients.map((c) => c.$disconnect()));
    await prisma.$disconnect();
  });

  // distribute() settles the hour that JUST ended (Date.now() - 60s).
  const endedPeriod = () => periodForHour(Date.now() - 60_000);
  const nextPeriod = () => periodForHour(Date.now() + 3_600_000 - 60_000);

  it('a no-eligible pool rolls over EXACTLY once, even called twice / concurrently', async () => {
    const period = endedPeriod();
    const next = nextPeriod();
    const base = 7_000_000n; // tip 0 → total = base; rollover increments `next` by `base`
    // Pre-create BOTH rows (next at 0) so the rollover takes the deterministic
    // increment path: a single rollover → next.baseLamports == base; a double
    // (guard failed) → 2× base.
    await prisma.airdropPool.deleteMany({ where: { period: { in: [period, next] } } });
    await prisma.airdropPool.create({
      data: { period, baseLamports: base, tipLamports: 0n, distributed: false },
    });
    await prisma.airdropPool.create({
      data: { period: next, baseLamports: 0n, tipLamports: 0n, distributed: false },
    });
    // Force the no-eligible ROLLOVER path: clear any Bet/ChatMessage in this pool's
    // hour window (other specs in the shared test DB create bets "now", which would
    // otherwise make users eligible and take the credit path instead).
    const hourStart = new Date(
      Date.parse(
        `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}T${period.slice(8, 10)}:00:00Z`,
      ),
    );
    const hourEnd = new Date(hourStart.getTime() + 3_600_000);
    await prisma.bet.deleteMany({ where: { createdAt: { gte: hourStart, lt: hourEnd } } });
    await prisma.chatMessage.deleteMany({ where: { createdAt: { gte: hourStart, lt: hourEnd } } });

    // Two concurrent distribute() runs on separate connections (no eligible users
    // → both take the rollover path). The guarded claim must let only one roll over.
    const a = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    const b = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    clients.push(a, b);
    await Promise.allSettled([engine(a).distribute(), engine(b).distribute()]);

    expect((await prisma.airdropPool.findUniqueOrThrow({ where: { period } })).distributed).toBe(
      true,
    );
    // Rolled over EXACTLY once — not 2× base (which a double rollover would produce).
    expect(
      (await prisma.airdropPool.findUniqueOrThrow({ where: { period: next } })).baseLamports,
    ).toBe(base);

    // A third, sequential call is a no-op (pre-check + guard both stop it).
    await engine().distribute();
    expect(
      (await prisma.airdropPool.findUniqueOrThrow({ where: { period: next } })).baseLamports,
    ).toBe(base);
  });
});
