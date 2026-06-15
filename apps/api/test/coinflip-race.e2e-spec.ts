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
      walletAddress: `cfrace-${RUN}-${seq}`,
      refCode: `cfrace-ref-${RUN}-${seq}`,
      playBalanceLamports: balance,
    },
  });
}

async function sumBalances(ids: string[]) {
  const us = await prisma.user.findMany({ where: { id: { in: ids } } });
  return us.reduce((s, u) => s + u.playBalanceLamports, 0n);
}

describe('coinflip double-resolve race (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('two concurrent joiners on one open flip: exactly one resolves, one rejects, one payout, balance conserved modulo house edge', async () => {
    const stake = 1_000_000n;
    const creator = await makeUser(stake); // debited at create time
    const joinerA = await makeUser(stake);
    const joinerB = await makeUser(stake);
    const ids = [creator.id, joinerA.id, joinerB.id];

    const totalBefore = await sumBalances(ids); // 3 * stake

    const flip = await svc.create({ userId: creator.id, side: 'heads', amountLamports: stake });

    const [ra, rb] = await Promise.allSettled([
      svc.join({ userId: joinerA.id, gameId: flip.id }),
      svc.join({ userId: joinerB.id, gameId: flip.id }),
    ]);

    const fulfilled = [ra, rb].filter((r) => r.status === 'fulfilled');
    const rejected = [ra, rb].filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // The flip resolves to `completed` exactly once.
    const game = await prisma.coinflipGame.findUniqueOrThrow({ where: { id: flip.id } });
    expect(game.status).toBe('completed');

    // Exactly two Bet rows (one per side); exactly one is a win, paid 1.9x.
    const bets = await prisma.bet.findMany({ where: { gameType: 'coinflip', seedId: game.seedId } });
    expect(bets.length).toBe(2);
    const won = bets.filter((b) => b.status === 'won');
    expect(won.length).toBe(1);
    expect(won[0]!.payoutLamports).toBe((stake * 19n) / 10n);

    // Conservation: the single creator stake funds exactly one payout. The pot
    // is 2*stake, the winner gets 1.9*stake, so total play balance falls by the
    // 0.1*stake house edge — never more (no double payout), never below zero.
    const totalAfter = await sumBalances(ids);
    expect(totalBefore - totalAfter).toBe(stake / 10n);
    for (const id of ids) {
      const u = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(u.playBalanceLamports >= 0n).toBe(true);
    }
  });
});
