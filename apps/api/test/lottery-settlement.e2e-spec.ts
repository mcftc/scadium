import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, randomInt } from 'node:crypto';
import { LOTTERY, ticketPriceScadBase } from '@scadium/shared';
import { prisma, makeUser, makeSeed, makeLotteryEngine } from './engine-harness';

/**
 * #62 — lottery settlement atomicity (integration, real Postgres). Chain is
 * disabled, so `drawAndSettle` derives the 6-digit number from a synthetic slot
 * hash (deterministic) and settles the pool off-chain. Induce a mid-settle
 * failure with a ticket whose userId has no User row (P2025 in `tx.user.update`)
 * → assert zero partial effects, the draw stays 'open', the seed is not
 * revealed, and a dead-letter row exists.
 */

/** Open draw (drawAt in the past) + a ticket; unique drawIndex per draw. */
async function setupDraw(userId: string) {
  const seed = await makeSeed();
  const drawIndex = BigInt(randomInt(1, 2_000_000_000));
  const draw = await prisma.lotteryDraw.create({
    data: { seedId: seed.id, nonce: 0, status: 'open', drawIndex, drawAt: new Date(Date.now() - 60_000) },
  });
  const ticket = await prisma.lotteryTicket.create({
    data: {
      drawId: draw.id,
      userId,
      digits: [1, 2, 3, 4, 5, 6],
      costLamports: 0n,
      costScadBase: ticketPriceScadBase(),
    },
  });
  return { seed, draw, ticket };
}

function prime(
  engine: unknown,
  draw: { id: string; drawIndex: bigint | null },
  seed: { id: string; serverSeed: string | null; serverSeedHash: string; clientSeed: string },
) {
  const e = engine as Record<string, unknown>;
  e.recovering = true;
  e.current = {
    id: draw.id,
    drawIndex: draw.drawIndex,
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
}
const draw = (engine: unknown) =>
  (engine as { drawAndSettle: () => Promise<void> }).drawAndSettle();

/**
 * Induce a mid-settle failure. Lottery tickets are FK-bound to User, so we
 * can't insert a ticket for a missing user. Instead point the in-flight draw at
 * a Seed that doesn't exist: the in-transaction `Bet.create` then throws,
 * exercising the atomic-rollback + dead-letter branch.
 */
const poisonSeed = (engine: unknown) => {
  (engine as { current: { seedId: string } }).current.seedId = randomUUID();
};
const DB_FAIL = /P2025|P2003|not found|No record|foreign key|constraint/i;

describe('lottery settlement (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('happy path: draw drawn with 6 winning digits, ticket settled, Bet row, seed revealed', async () => {
    const u = await makeUser(0n);
    const { seed, draw: d, ticket } = await setupDraw(u.id);

    const engine = makeLotteryEngine();
    prime(engine, d, seed);
    await draw(engine);

    const after = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.status).toBe('drawn');
    expect(after.winningDigits).toHaveLength(LOTTERY.DIGITS);

    const ticketAfter = await prisma.lotteryTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    // matchLen is recomputed and written (0..6) — proves the ticket update committed.
    expect(ticketAfter.matchLen).toBeGreaterThanOrEqual(0);
    expect(ticketAfter.matchLen).toBeLessThanOrEqual(LOTTERY.DIGITS);

    expect(await prisma.bet.count({ where: { userId: u.id, gameType: 'lottery' } })).toBe(1);
    expect((await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } })).revealedAt).not.toBeNull();
    expect(await prisma.settlementFailure.count({ where: { gameType: 'lottery', roundId: d.id } })).toBe(0);
  });

  it('induced failure: zero partial effects, draw stays open, dead-letter written', async () => {
    const u = await makeUser(0n);
    const { seed, draw: d, ticket } = await setupDraw(u.id);

    const engine = makeLotteryEngine();
    prime(engine, d, seed);
    poisonSeed(engine); // in-tx Bet.create FK throws
    await draw(engine); // swallows the error

    expect((await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('open');
    expect((await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } })).revealedAt).toBeNull();

    // Ticket update rolled back: still the create-time defaults (no win recorded).
    const ticketAfter = await prisma.lotteryTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(ticketAfter.won).toBe(false);
    expect(ticketAfter.bracket).toBeNull();
    expect(ticketAfter.payoutScadBase).toBe(0n);

    expect(await prisma.bet.count({ where: { userId: u.id } })).toBe(0);
    const failures = await prisma.settlementFailure.findMany({
      where: { gameType: 'lottery', roundId: d.id },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.error).toMatch(DB_FAIL);
  });
});
