import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, makeUser } from './engine-harness';
import { RgService } from '../src/responsible-gambling/rg.service';

const rg = new RgService(prisma as never);

describe('rg self-exclusion (#46, integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('blocks wagering after self-exclusion and refuses to shorten it', async () => {
    const u = await makeUser(0n);
    const until = new Date(Date.now() + 7 * 86_400_000);
    await rg.setSelfExclusion(u.id, until);

    await expect(rg.assertCanWager(u.id, 100n)).rejects.toThrow(/self-excluded/i);

    // Shortening (an earlier end date) is rejected.
    await expect(
      rg.setSelfExclusion(u.id, new Date(Date.now() + 86_400_000)),
    ).rejects.toThrow(/shorten/i);

    // Extending (a later end date) is allowed.
    const longer = new Date(Date.now() + 30 * 86_400_000);
    const state = await rg.setSelfExclusion(u.id, longer);
    expect(state.selfExcludedUntil).toBe(longer.toISOString());
  });
});
