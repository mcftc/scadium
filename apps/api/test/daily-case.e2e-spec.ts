import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { dailyCaseRoll, pickCaseTier, commitServerSeed } from '@scadium/fair';
import { SCAD } from '@scadium/shared';
import { RewardsService } from '../src/rewards/rewards.service';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import { prisma, offChain, makeUser } from './engine-harness';

interface FairBlock {
  roll: string; // persisted as a string (#128) so the trail round-trips exactly
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}
type Trail = FairBlock & { tier: string };

/**
 * Issue #22 — the Daily Case prize derives from the committed HMAC fair engine
 * (player's active seed pair + monotonic nonce), not Math.random(). The trail
 * persisted on RewardClaim.resultJson must reproduce the awarded tier once the
 * server seed is revealed via rotation, and the 24h cooldown stays intact.
 */
describe('daily case provable fairness (issue #22)', () => {
  const seeds = new SeedManagerService(prisma as never);
  const svc = new RewardsService(prisma as never, offChain, seeds);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists a verifiable trail and the revealed seed reproduces the tier', async () => {
    const user = await makeUser(0n);
    await seeds.setClientSeed(user.id, 'my-case-seed');

    const opened = (await svc.openDailyCase(user.id)) as unknown as {
      tier: string;
      fair: FairBlock;
    };
    expect(opened.fair.clientSeed).toBe('my-case-seed');
    expect(opened.fair.nonce).toBeGreaterThan(0);

    // Trail persisted on the claim row.
    const claim = await prisma.rewardClaim.findFirstOrThrow({
      where: { userId: user.id, kind: 'dailyCase' },
    });
    const trail = claim.resultJson as unknown as Trail;
    expect(trail.tier).toBe(opened.tier);
    expect(trail.serverSeedHash).toBe(opened.fair.serverSeedHash);
    expect(trail.clientSeed).toBe('my-case-seed');
    expect(trail.nonce).toBe(opened.fair.nonce);

    // Reveal via standard rotation, then independently reproduce the tier.
    const { revealedServerSeed } = await seeds.rotateServerSeed(user.id);
    expect(commitServerSeed(revealedServerSeed)).toBe(trail.serverSeedHash);
    const roll = dailyCaseRoll(revealedServerSeed, trail.clientSeed, trail.nonce);
    expect(trail.roll).toBe(roll.toString()); // exact string round-trip (#128)
    expect(pickCaseTier(roll, SCAD.CASE_TIERS).tier).toBe(opened.tier);

    // Determinism: same inputs, same tier, every time.
    expect(dailyCaseRoll(revealedServerSeed, trail.clientSeed, trail.nonce)).toBe(roll);
  });

  it('rejects a second open within 24h (cooldown regression guard)', async () => {
    const user = await makeUser(0n);
    await svc.openDailyCase(user.id);
    await expect(svc.openDailyCase(user.id)).rejects.toThrow(BadRequestException);
    // The rejected open must not have burned a nonce or written a claim.
    const claims = await prisma.rewardClaim.count({
      where: { userId: user.id, kind: 'dailyCase' },
    });
    expect(claims).toBe(1);
  });

  it('a rejected open does not advance the nonce', async () => {
    const user = await makeUser(0n);
    await svc.openDailyCase(user.id);
    const before = await prisma.clientSeed.findUniqueOrThrow({ where: { userId: user.id } });
    await expect(svc.openDailyCase(user.id)).rejects.toThrow(BadRequestException);
    const after = await prisma.clientSeed.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.nonce).toBe(before.nonce);
  });
});
