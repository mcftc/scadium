import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CoinflipService } from '../src/games/coinflip/coinflip.service';
import { SeedManagerService } from '../src/fairness/seed-manager.service';

// TODO(harness #9): fold this bootstrap into the shared concurrency harness.
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

const gateway = { emitCreated() {}, emitResolved() {}, emitCancelled() {} } as never;
const chain = { enabled: false } as never;
const svc = new CoinflipService(
  prisma as never,
  gateway,
  chain,
  new SeedManagerService(prisma as never),
  { assertCanWager: async () => undefined } as never,
  { creditReferral: async () => undefined } as never,
);

const RUN = `${Date.now().toString(36)}`;
let seq = 0;
async function makeUser(balance: bigint) {
  seq += 1;
  return prisma.user.create({
    data: {
      walletAddress: `bw-${RUN}-${seq}`,
      refCode: `bw-ref-${RUN}-${seq}`,
      playBalanceLamports: balance,
    },
  });
}

describe('coinflip biggestWin under concurrency (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('biggestWin == max winning-flip profit (from Bet), even with concurrent resolves', async () => {
    // One creator opens N flips of VARYING stake; N joiners resolve them
    // concurrently. Whenever the creator wins, the winner row (creator) gets a
    // concurrent GREATEST update — the prior stale read-then-write would clobber
    // and understate biggestWin. The invariant below holds regardless of which
    // flips happen to win.
    const N = 20;
    const stakes = Array.from({ length: N }, (_, i) => BigInt((i + 1) * 1_000_000)); // 1..20 mSOL
    const creator = await makeUser(1_000_000_000_000n); // amply funded

    // Open all flips first (creator debited per create).
    const games: Array<{ id: string }> = [];
    for (const stake of stakes) {
      games.push(await svc.create({ userId: creator.id, side: 'heads', amountLamports: stake }));
    }

    // Each flip joined by its own funded joiner, concurrently.
    const joiners = await Promise.all(stakes.map(() => makeUser(1_000_000_000_000n)));
    await Promise.all(
      games.map((g, i) => svc.join({ userId: joiners[i]!.id, gameId: g.id })),
    );

    // Cross-check against the Bet table: biggestWin must equal the creator's
    // largest single-flip profit (payout - stake) among won bets, or 0 if none.
    const wonBets = await prisma.bet.findMany({
      where: { userId: creator.id, gameType: 'coinflip', status: 'won' },
    });
    const expected = wonBets.reduce(
      (m, b) => {
        const p = b.payoutLamports - b.amountLamports;
        return p > m ? p : m;
      },
      0n,
    );

    const after = await prisma.user.findUniqueOrThrow({ where: { id: creator.id } });
    expect(after.biggestWin).toBe(expected);
  });
});
