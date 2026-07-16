import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { prisma, makeUser } from './engine-harness';

/**
 * H18 — accrued affiliate commission must be collectible. Previously commission
 * accumulated on Referral rows with NO claim path (the dashboard showed
 * uncollectable SOL). claim() credits (commission - claimed) to the referrer's
 * play balance and advances the claimed marker, paying each lamport once.
 */
describe('affiliate commission claim (H18, integration)', () => {
  const svc = new AffiliatesService(prisma as never);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('credits accrued commission once, then rejects a repeat claim', async () => {
    const referrer = await makeUser(0n);
    const referee = await makeUser(0n);
    await prisma.user.update({
      where: { id: referee.id },
      data: { referredById: referrer.id },
    });
    await prisma.referral.create({
      data: {
        id: randomUUID(),
        referrerId: referrer.id,
        refereeId: referee.id,
        volumeLamports: 1_000_000n,
        commissionLamports: 5_000n,
        flagged: false,
      },
    });

    // Before: dashboard shows 5_000 claimable, balance untouched.
    const before = await svc.stats(referrer.id);
    expect(before.claimableCommissionLamports).toBe('5000');

    const res = await svc.claim(referrer.id);
    expect(res.claimedLamports).toBe('5000');

    const paid = await prisma.user.findUniqueOrThrow({ where: { id: referrer.id } });
    expect(paid.playBalanceLamports).toBe(5_000n); // credited to the play balance

    const after = await svc.stats(referrer.id);
    expect(after.claimableCommissionLamports).toBe('0');
    expect(after.claimedCommissionLamports).toBe('5000');

    // A second claim with nothing new accrued is rejected — no double pay.
    await expect(svc.claim(referrer.id)).rejects.toThrow();
    const stillPaid = await prisma.user.findUniqueOrThrow({ where: { id: referrer.id } });
    expect(stillPaid.playBalanceLamports).toBe(5_000n);
  });

  it('a further accrual becomes claimable again (delta only)', async () => {
    const referrer = await makeUser(0n);
    const referee = await makeUser(0n);
    await prisma.user.update({ where: { id: referee.id }, data: { referredById: referrer.id } });
    const ref = await prisma.referral.create({
      data: {
        id: randomUUID(),
        referrerId: referrer.id,
        refereeId: referee.id,
        volumeLamports: 1_000_000n,
        commissionLamports: 3_000n,
        flagged: false,
      },
    });
    await svc.claim(referrer.id); // claims 3_000

    // More wagering accrues another 2_000 of commission.
    await prisma.referral.update({
      where: { id: ref.id },
      data: { commissionLamports: { increment: 2_000n } },
    });

    const res = await svc.claim(referrer.id);
    expect(res.claimedLamports).toBe('2000'); // only the delta
    const paid = await prisma.user.findUniqueOrThrow({ where: { id: referrer.id } });
    expect(paid.playBalanceLamports).toBe(5_000n); // 3_000 + 2_000
  });
});
