import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, realPow } from './engine-harness';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { DiceService } from '../src/games/dice/dice.service';
import { SeedManagerService } from '../src/fairness/seed-manager.service';

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
    await aff.creditReferral(prisma as never, b.id, 5n * SOL, 'coinflip');
    const rows = await prisma.referral.findMany({ where: { referrerId: a.id, refereeId: b.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.volumeLamports).toBe(5n * SOL);
    // 5 SOL × coinflip's 5% edge × tier-0 5% — a share of the house take (B1).
    expect(rows[0]!.commissionLamports).toBe((5n * SOL * 5n * 5n) / 10_000n);
    expect(rows[0]!.flagged).toBe(false);
  });

  it('flags a same-IP referrer/referee pair and accrues no commission', async () => {
    const a = await mkUser({ signupIpHash: 'shared-ip' });
    const b = await mkUser({ referredById: a.id, signupIpHash: 'shared-ip' });
    await aff.creditReferral(prisma as never, b.id, 5n * SOL, 'coinflip');
    const row = await prisma.referral.findUniqueOrThrow({ where: { refereeId: b.id } });
    expect(row.flagged).toBe(true);
    expect(row.commissionLamports).toBe(0n);
    expect(row.volumeLamports).toBe(5n * SOL);
  });

  it('no-ops for a user without a referrer', async () => {
    const u = await mkUser({});
    await aff.creditReferral(prisma as never, u.id, 5n * SOL, 'coinflip');
    expect(await prisma.referral.findUnique({ where: { refereeId: u.id } })).toBeNull();
  });

  // #47 coverage — the money bug was that only crash + coinflip credited
  // referrers; the other 10 games earned the referrer nothing. Drive a REAL
  // dice play (the shared instant-settle path used by dice/limbo/wheel/plinko)
  // and assert the referrer is now credited end-to-end.
  it('a referred player’s dice bet credits the referrer through settlement', async () => {
    const referrer = await mkUser({ signupIpHash: 'ip-ref' });
    const referee = await mkUser({ referredById: referrer.id, signupIpHash: 'ip-ee' });
    await prisma.user.update({
      where: { id: referee.id },
      data: { playBalanceLamports: SOL },
    });

    const dice = new DiceService(
      prisma as never,
      new SeedManagerService(prisma as never),
      { assertCanWager: async () => undefined } as never,
      realPow(),
      aff,
    );
    const stake = SOL / 10n; // 0.1 SOL
    await dice.play({ userId: referee.id, amountLamports: stake, target: 50, mode: 'under' });

    const row = await prisma.referral.findUniqueOrThrow({ where: { refereeId: referee.id } });
    expect(row.referrerId).toBe(referrer.id);
    expect(row.volumeLamports).toBe(stake);
    // 0.1 SOL × dice's 1% edge × tier-0 5% (B1: a share of the edge, not the stake).
    expect(row.commissionLamports).toBe((stake * 1n * 5n) / 10_000n);
  });
});
