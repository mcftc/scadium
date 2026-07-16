import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, realPow, affiliatesStub } from './engine-harness';
import { DiceService } from '../src/games/dice/dice.service';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import type { LiveFeedService } from '../src/live/live-feed.service';
import type { SettledBetInput } from '../src/live/live-feed.types';

const SOL = 1_000_000_000n;

const mkUser = () =>
  prisma.user.create({
    data: {
      walletAddress: `live-${randomUUID()}`,
      refCode: `live-${randomUUID().slice(0, 12)}`,
      playBalanceLamports: SOL,
    },
  });

describe('live-feed settlement wiring (#roadmap-4, integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('publishes a settled dice bet to the live feed AFTER the settlement commits', async () => {
    const user = await mkUser();
    const captured: SettledBetInput[] = [];
    const liveFeed = {
      publishSettledBet: vi.fn((input: SettledBetInput) => {
        captured.push(input);
      }),
    } as unknown as LiveFeedService;

    const dice = new DiceService(
      prisma as never,
      new SeedManagerService(prisma as never),
      { assertCanWager: async () => undefined } as never,
      realPow(),
      affiliatesStub(),
      undefined, // onchainRng
      liveFeed,
    );

    const stake = SOL / 10n; // 0.1 SOL
    const res = await dice.play({ userId: user.id, amountLamports: stake, target: 50, mode: 'under' });

    // Exactly one feed event, carrying the SAME bet the DB persisted.
    expect(captured).toHaveLength(1);
    const evt = captured[0]!;
    expect(evt.betId).toBe(res.betId);
    expect(evt.userId).toBe(user.id);
    expect(evt.gameType).toBe('dice');
    expect(evt.amountLamports).toBe(stake);
    expect(evt.payoutLamports).toBe(BigInt(res.payoutLamports));
    expect(evt.won).toBe(res.won);

    // The Bet row it references actually exists (proves post-commit ordering).
    const row = await prisma.bet.findUniqueOrThrow({ where: { id: evt.betId } });
    expect(row.userId).toBe(user.id);
    expect(row.gameType).toBe('dice');
  });
});
