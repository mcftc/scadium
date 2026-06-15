import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from './engine-harness';
import { AffiliatesService } from '../src/affiliates/affiliates.service';

const SOL = 1_000_000_000n;
const aff = new AffiliatesService(prisma as never);

const mkUser = (over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: { walletAddress: `aff-${randomUUID()}`, refCode: `aff-${randomUUID().slice(0, 12)}`, ...over },
  });

describe('affiliate write-path (#47, integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accrues volume + tier-0 commission to the referrer on a referred wager', async () => {
    const a = await mkUser({ signupIpHash: 'ip-A' });
    const b = await mkUser({ referredById: a.id, signupIpHash: 'ip-B' });
    await aff.creditReferral(prisma as never, b.id, 5n * SOL);
    const rows = await prisma.referral.findMany({ where: { referrerId: a.id, refereeId: b.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.volumeLamports).toBe(5n * SOL);
    expect(rows[0]!.commissionLamports).toBe((5n * SOL * 5n) / 100n); // tier 0 = 5%
    expect(rows[0]!.flagged).toBe(false);
  });

  it('flags a same-IP referrer/referee pair and accrues no commission', async () => {
    const a = await mkUser({ signupIpHash: 'shared-ip' });
    const b = await mkUser({ referredById: a.id, signupIpHash: 'shared-ip' });
    await aff.creditReferral(prisma as never, b.id, 5n * SOL);
    const row = await prisma.referral.findUniqueOrThrow({ where: { refereeId: b.id } });
    expect(row.flagged).toBe(true);
    expect(row.commissionLamports).toBe(0n);
    expect(row.volumeLamports).toBe(5n * SOL);
  });

  it('no-ops for a user without a referrer', async () => {
    const u = await mkUser({});
    await aff.creditReferral(prisma as never, u.id, 5n * SOL);
    expect(await prisma.referral.findUnique({ where: { refereeId: u.id } })).toBeNull();
  });
});
