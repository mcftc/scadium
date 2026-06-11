import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { getPrisma } from './setup';
import { RewardsService } from '../src/rewards/rewards.service';
import type { ChainService } from '../src/solana/chain.service';
import type { SeedManagerService } from '../src/fairness/seed-manager.service';

/**
 * #28 — reward-claim custody over real Postgres, chain stubbed at the
 * ChainService seam. The old code decremented scadiumBalance and THEN fired a
 * fire-and-forget chain claim: a null return silently consumed the funds.
 * Now: pending+reserve → confirm finalizes / permanent failure restores.
 */
describe('reward-claim custody lifecycle (integration, real Postgres)', () => {
  const prisma = getPrisma();
  const RUN = Date.now().toString(36);
  let seq = 0;

  const makeUser = (scad = 1_000_000_000n) => {
    seq += 1;
    return prisma.user.create({
      data: {
        walletAddress: `rc-${RUN}-${seq}`,
        refCode: `rc-ref-${RUN}-${seq}`,
        scadiumBalance: scad,
      },
    });
  };

  /** RewardsService with a chain that returns `sig` from claimReward. */
  const serviceWith = (sig: string | null, enabled = true) =>
    new RewardsService(
      prisma as never,
      { enabled, claimReward: async () => sig } as unknown as ChainService,
      {} as SeedManagerService, // only used by openDailyCase's seed flow
    );

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('chain DISABLED → claim rejected, balance untouched (no silent consumption)', async () => {
    const u = await makeUser(700n);
    const svc = serviceWith(null, false);
    await expect(svc.claim(u.id, 'wagerReward')).rejects.toThrow(BadRequestException);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.scadiumBalance).toBe(700n);
    expect(after.scadiumReserved).toBe(0n);
  });

  it('claim reserves (not consumes); a confirmed chain transfer finalizes the debit once', async () => {
    const u = await makeUser(500n);
    const svc = serviceWith('sig-ok');

    await svc.claim(u.id, 'wagerReward'); // immediate attempt fires async
    // Drive the lifecycle deterministically via the worker entrypoint.
    await svc.reconcilePendingClaims();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.scadiumBalance).toBe(0n);
    expect(after.scadiumReserved).toBe(0n); // finalized, not stuck in reserve
    const claim = await prisma.rewardClaim.findFirstOrThrow({
      where: { userId: u.id, kind: 'wagerReward' },
    });
    expect(claim.status).toBe('confirmed');
    expect(claim.txSignature).toBe('sig-ok');

    // Re-running the worker never double-finalizes.
    await svc.reconcilePendingClaims();
    const again = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(again.scadiumReserved).toBe(0n);
    expect(again.scadiumBalance).toBe(0n);
  });

  it('a permanently failing chain RESTORES the reserve — no silent loss', async () => {
    const u = await makeUser(900n);
    const svc = serviceWith(null); // chain enabled but every attempt fails

    await svc.claim(u.id, 'wagerReward');
    const mid = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(mid.scadiumBalance).toBe(0n);
    expect(mid.scadiumReserved).toBe(900n); // reserved, NOT consumed

    for (let i = 0; i < RewardsService.MAX_CLAIM_ATTEMPTS + 1; i++) {
      await svc.reconcilePendingClaims();
    }

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.scadiumBalance).toBe(900n); // restored — pre-claim state
    expect(after.scadiumReserved).toBe(0n);
    const claim = await prisma.rewardClaim.findFirstOrThrow({
      where: { userId: u.id, kind: 'wagerReward' },
    });
    expect(claim.status).toBe('failed');
    expect(claim.txSignature).toBeNull();
  });

  it('a second claim is rejected while one is pending (no double-spend of the window)', async () => {
    const u = await makeUser(400n);
    const svc = serviceWith(null);
    await svc.claim(u.id, 'wagerReward');
    // Accrue more SCAD, then try to claim again while the first is pending.
    await prisma.user.update({ where: { id: u.id }, data: { scadiumBalance: 100n } });
    await expect(svc.claim(u.id, 'wagerReward')).rejects.toThrow('already pending');
  });

  it('cashback: nothing consumed until confirm; the baseline bumps exactly at confirm', async () => {
    const u = await makeUser(0n);
    await prisma.user.update({
      where: { id: u.id },
      data: { totalLost: 10_000_000_000n, cashbackBaselineLost: 0n },
    });
    const svc = serviceWith('sig-cb');
    await svc.claim(u.id, 'cashback');
    await svc.reconcilePendingClaims();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.cashbackBaselineLost).toBe(10_000_000_000n); // bumped at confirm
    const claim = await prisma.rewardClaim.findFirstOrThrow({
      where: { userId: u.id, kind: 'cashback' },
    });
    expect(claim.status).toBe('confirmed');
  });
});
