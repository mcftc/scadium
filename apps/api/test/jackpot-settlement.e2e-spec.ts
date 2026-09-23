import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { JACKPOT } from '@scadium/shared';
import { prisma, makeUser, makeSeed, makeJackpotEngine } from './engine-harness';
import { JackpotEngine } from '../src/games/jackpot/jackpot.engine';

/**
 * #62 — jackpot settlement atomicity (integration, real Postgres). Mirrors the
 * crash spec (settlement-atomicity.e2e-spec.ts): induce a mid-settle failure by
 * including an entry whose userId has no User row (so `tx.user.update` /
 * `applyBalanceDelta` throws P2025), then assert zero partial effects, a
 * dead-letter row, and that the round is NOT advanced. Covers BOTH jackpot
 * paths — draw (≥ MIN_PLAYERS distinct) and refund (< MIN_PLAYERS).
 */

/** Build an 'open' round (closeAt in the past) + its entries. */
async function setupRound(entries: { userId: string; amount: bigint }[]) {
  const seed = await makeSeed();
  const round = await prisma.jackpotRound.create({
    data: { seedId: seed.id, nonce: 0, status: 'open', closeAt: new Date(Date.now() - 60_000) },
  });
  for (const e of entries) {
    await prisma.jackpotEntry.create({
      data: { roundId: round.id, userId: e.userId, amountLamports: e.amount },
    });
  }
  return { seed, round };
}

/** Reconstruct `this.current` (like recovery does) + suppress the chained openNewRound. */
function prime(
  engine: unknown,
  round: { id: string },
  seed: { id: string; serverSeed: string | null; serverSeedHash: string; clientSeed: string },
) {
  const e = engine as Record<string, unknown>;
  e.recovering = true;
  e.current = {
    id: round.id,
    seedId: seed.id,
    serverSeed: seed.serverSeed,
    serverSeedHash: seed.serverSeedHash,
    clientSeed: seed.clientSeed,
    nonce: 0,
    closeAt: Date.now(),
    status: 'open',
    totalLamports: 0n,
    players: new Set<string>(),
  };
}
const draw = (engine: unknown) =>
  (engine as { drawAndSettle: () => Promise<void> }).drawAndSettle();

/**
 * Induce a mid-settle failure. Jackpot entries are FK-bound to User, so (unlike
 * crash's in-memory bets) we can't insert an entry for a missing user. Instead
 * point the in-flight round at a Seed that doesn't exist: the in-transaction
 * `Bet.create` (draw path) / `seed.update` (refund path) then throws, exercising
 * the exact atomic-rollback + dead-letter branch.
 */
const poisonSeed = (engine: unknown) => {
  (engine as { current: { seedId: string } }).current.seedId = randomUUID();
};
const DB_FAIL = /P2025|P2003|not found|No record|foreign key|constraint/i;

describe('jackpot settlement (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('draw happy path: winner credited, Bet rows, round drawn, seed revealed', async () => {
    const u1 = await makeUser(0n);
    const u2 = await makeUser(0n);
    const { seed, round } = await setupRound([
      { userId: u1.id, amount: 1_000_000n },
      { userId: u2.id, amount: 1_000_000n },
    ]);

    const engine = makeJackpotEngine();
    prime(engine, round, seed);
    await draw(engine);

    const after = await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(after.status).toBe('drawn');
    expect(after.winnerId).not.toBeNull();

    const total = 2_000_000n;
    const payout = (total * BigInt(Math.round((1 - JACKPOT.HOUSE_EDGE) * 1000))) / 1000n;
    const credited = (await prisma.user.findMany({ where: { id: { in: [u1.id, u2.id] } } })).reduce(
      (s, u) => s + u.playBalanceLamports,
      0n,
    );
    expect(credited).toBe(payout); // only the winner is credited; sum == payout

    expect(await prisma.bet.count({ where: { userId: { in: [u1.id, u2.id] } } })).toBe(2);
    expect(
      (await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } })).revealedAt,
    ).not.toBeNull();
    expect(
      await prisma.settlementFailure.count({ where: { gameType: 'jackpot', roundId: round.id } }),
    ).toBe(0);
  });

  it('draw induced failure: zero partial effects, round stays open, dead-letter written', async () => {
    const u1 = await makeUser(0n);
    const u2 = await makeUser(0n); // 2 distinct players → draw path
    const { seed, round } = await setupRound([
      { userId: u1.id, amount: 1_000_000n },
      { userId: u2.id, amount: 1_000_000n },
    ]);

    const engine = makeJackpotEngine();
    prime(engine, round, seed);
    poisonSeed(engine); // in-tx Bet.create FK throws
    await draw(engine); // swallows the error

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: u1.id } })).playBalanceLamports,
    ).toBe(0n);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: u2.id } })).playBalanceLamports,
    ).toBe(0n);
    expect(await prisma.bet.count({ where: { userId: { in: [u1.id, u2.id] } } })).toBe(0);
    expect((await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'open',
    );
    expect((await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } })).revealedAt).toBeNull();

    const failures = await prisma.settlementFailure.findMany({
      where: { gameType: 'jackpot', roundId: round.id },
    });
    expect(failures).toHaveLength(1);
    expect((failures[0]!.payloadJson as { path?: string }).path).toBe('draw');
    expect(failures[0]!.error).toMatch(DB_FAIL);
  });

  it('refund happy path: entry refunded, round refunded, seed revealed, no Bet rows', async () => {
    const u1 = await makeUser(0n);
    const { seed, round } = await setupRound([{ userId: u1.id, amount: 1_000_000n }]); // 1 distinct < MIN_PLAYERS

    const engine = makeJackpotEngine();
    prime(engine, round, seed);
    await draw(engine);

    expect((await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'refunded',
    );
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: u1.id } })).playBalanceLamports,
    ).toBe(1_000_000n);
    expect(await prisma.bet.count({ where: { userId: u1.id } })).toBe(0);
    expect(
      (await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } })).revealedAt,
    ).not.toBeNull();
    expect(
      await prisma.settlementFailure.count({ where: { gameType: 'jackpot', roundId: round.id } }),
    ).toBe(0);
  });

  it('refund induced failure: round stays open, dead-letter (path=refund), no money moved', async () => {
    const u1 = await makeUser(0n); // 1 distinct < MIN_PLAYERS → refund path
    const { seed, round } = await setupRound([{ userId: u1.id, amount: 1_000_000n }]);

    const engine = makeJackpotEngine();
    prime(engine, round, seed);
    poisonSeed(engine); // in-tx seed.update throws P2025 → whole refund rolls back
    await draw(engine);

    expect((await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'open',
    );
    expect((await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } })).revealedAt).toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: u1.id } })).playBalanceLamports,
    ).toBe(0n); // refund rolled back
    expect(await prisma.bet.count({ where: { userId: u1.id } })).toBe(0);

    const failures = await prisma.settlementFailure.findMany({
      where: { gameType: 'jackpot', roundId: round.id },
    });
    expect(failures).toHaveLength(1);
    expect((failures[0]!.payloadJson as { path?: string }).path).toBe('refund');
    expect(failures[0]!.error).toMatch(DB_FAIL);
  });
});

describe('jackpot ticket→winner verifiability (B3, integration)', () => {
  it('persists entry-ordered ranges that tile the pot, and the winner owns the ticket', async () => {
    const users = [await makeUser(0n), await makeUser(0n), await makeUser(0n)];
    const amounts = [3_000_000n, 1_000_000n, 6_000_000n];
    const { seed, round } = await setupRound(
      users.map((u, i) => ({ userId: u.id, amount: amounts[i]! })),
    );

    const emitted: unknown[] = [];
    const engine = new JackpotEngine(
      prisma as never,
      new Proxy(
        {},
        {
          get: (_t, k) =>
            k === 'emitDrawResult' ? (p: unknown) => emitted.push(p) : () => undefined,
        },
      ) as never,
      { enabled: false } as never,
      { accrue: async () => 0n } as never,
      { creditReferral: async () => undefined } as never,
    );
    prime(engine, round, seed);
    await draw(engine);

    const after = await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(after.status).toBe('drawn');
    const ranges = after.rangesJson as {
      playerId: string;
      start: string;
      end: string;
      amountLamports: string;
    }[];
    expect(ranges).toHaveLength(3);
    // Contiguous from 0 to the pot, each as wide as its stake.
    let cursor = 0n;
    for (const r of ranges) {
      expect(BigInt(r.start)).toBe(cursor);
      expect(BigInt(r.end) - BigInt(r.start)).toBe(BigInt(r.amountLamports));
      cursor = BigInt(r.end);
    }
    expect(cursor).toBe(after.totalLamports);
    // The winning ticket lies in exactly the recorded winner's range.
    const ticket = after.winningTicket!;
    const holder = ranges.filter((r) => ticket >= BigInt(r.start) && ticket < BigInt(r.end));
    expect(holder).toHaveLength(1);
    const winnerBet = await prisma.bet.findFirstOrThrow({
      where: { userId: after.winnerId!, gameType: 'jackpot' },
    });
    expect((winnerBet.resultJson as { range: { playerId: string } }).range.playerId).toBe(
      holder[0]!.playerId,
    );
    // The broadcast carries the same ranges, and no userId anywhere in it.
    const result = emitted[0] as { ranges: unknown[]; winnerPlayerId: string };
    expect(result.ranges).toEqual(ranges);
    expect(result.winnerPlayerId).toBe(holder[0]!.playerId);
    const wire = JSON.stringify(result);
    for (const u of users) {
      expect(wire).not.toContain(u.id);
      expect(wire).not.toContain(u.walletAddress);
    }
  });
});
