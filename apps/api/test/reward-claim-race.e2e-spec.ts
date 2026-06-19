import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma, TEST_DB_URL } from './engine-harness';
import { RewardsService } from '../src/rewards/rewards.service';
import type { ChainService } from '../src/solana/chain.service';
import type { SeedManagerService } from '../src/fairness/seed-manager.service';

/**
 * #214 — the reward/dividend claim reserves balance via a bare `decrement` under
 * Read Committed, so two concurrent claims both read the balance, both see 0
 * pending (each other's pending row is uncommitted), and both reserve → negative
 * balance + double reserve (and, once the chain is real, a double on-chain pay).
 *
 * Each racing claim runs on its OWN PrismaClient (separate Postgres connection),
 * since a single shared interactive-transaction client would serialize them.
 * This is a CONCURRENCY REGRESSION that locks the invariant (exactly one claim
 * reserves; balance never negative; reserved never inflated) — not a strict
 * red-before/green-after gate: the bare-`update` row-lock + fast single-process
 * timing rarely opens the count-before-commit window, so it does not reliably go
 * red against the pre-fix code. The fix's correctness rests on the same proven
 * guarded-`updateMany` + `withSerializable` pattern that #178's balance-race
 * chaos test validates for `applyBalanceDelta`. (Latent: the reserve path only
 * runs when `chain.enabled`.)
 */
describe('reward-claim concurrency (integration, real Postgres) — #214', () => {
  const RUN = Date.now().toString(36);
  let seq = 0;
  const clients: PrismaClient[] = [];

  const makeUser = (scad = 0n, usds = 0n) => {
    seq += 1;
    return prisma.user.create({
      data: {
        walletAddress: `rcr-${RUN}-${seq}`,
        refCode: `rcr-ref-${RUN}-${seq}`,
        scadiumBalance: scad,
        usdsBalance: usds,
      },
    });
  };

  // A RewardsService on a DEDICATED connection so the racers don't serialize on
  // one client. Chain enabled (the reserve path only runs when chain is on);
  // claimReward/claimDividend return null so the async post-tx attempt is a
  // pending no-op and we assert the committed reserve state.
  const racer = () => {
    const client = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    clients.push(client);
    return new RewardsService(
      client as never,
      {
        enabled: true,
        claimReward: async () => null,
        claimDividend: async () => null,
      } as unknown as ChainService,
      {} as SeedManagerService,
    );
  };

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await Promise.allSettled(clients.map((c) => c.$disconnect()));
    await prisma.$disconnect();
  });

  it('wagerReward: N concurrent claims reserve exactly once (no negative balance / double reserve)', async () => {
    const u = await makeUser(1_000_000n);
    const N = 5;
    const services = Array.from({ length: N }, () => racer());

    const results = await Promise.allSettled(services.map((s) => s.claim(u.id, 'wagerReward')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); // exactly one wins
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(N - 1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.scadiumBalance).toBe(0n); // NOT negative
    expect(after.scadiumReserved).toBe(1_000_000n); // reserved once, NOT N×
    expect(after.scadiumBalance >= 0n).toBe(true);
    expect(await prisma.rewardClaim.count({ where: { userId: u.id, kind: 'wagerReward' } })).toBe(
      1,
    ); // one pending claim, not N
  });

  it('dividend: N concurrent claims reserve exactly once', async () => {
    const u = await makeUser(0n, 500_000n);
    const N = 5;
    const services = Array.from({ length: N }, () => racer());

    const results = await Promise.allSettled(services.map((s) => s.claimDividend(u.id)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(N - 1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.usdsBalance).toBe(0n);
    expect(after.usdsReserved).toBe(500_000n); // not N×
    expect(await prisma.rewardClaim.count({ where: { userId: u.id, kind: 'dividend' } })).toBe(1);
  });
});
