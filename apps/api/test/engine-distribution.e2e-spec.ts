import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINE } from '@scadium/shared';
import { StakingService } from '../src/staking/staking.service';
import { DistributionService } from '../src/engine/distribution.service';
import { periodForHour } from '../src/queue/queue.constants';
import { prisma } from './engine-harness';

/**
 * SCAD Engine integration: stake → hourly distribution → claim/unstake, against
 * real Postgres. Proves the full money loop and its guards: the lock blocks an
 * early unstake, a round credits USDS pro-rata, and re-running the round is a
 * no-op (no double pay). Mirrors the airdrop-distribute idempotency style.
 */
describe('SCAD Engine — stake, distribute, lock', () => {
  // StakingService now takes (prisma, chain) — serializeSummary reads chain.enabled
  // (#208). Stub it disabled; this suite never asserts chainEnabled.
  const staking = new StakingService(prisma as never, { enabled: false } as never);
  const distribution = new DistributionService(prisma as never);

  const period = periodForHour(Date.now() - 60_000);
  const hourStart = new Date(Math.floor((Date.now() - 60_000) / 3_600_000) * 3_600_000);
  let userId: string;

  beforeAll(async () => {
    // Isolate this round from any rows other suites left in the shared test DB.
    // Delete the period's claims before its rounds (FK) — a prior run or another
    // suite that left staked users (which distribute() pays) would otherwise block this.
    const stale = await prisma.distributionRound.findMany({
      where: { period },
      select: { id: true },
    });
    await prisma.distributionClaim.deleteMany({
      where: { roundId: { in: stale.map((r) => r.id) } },
    });
    await prisma.distributionRound.deleteMany({ where: { period } });

    const id = randomUUID();
    const u = await prisma.user.create({
      data: {
        walletAddress: `eng-stk-${id}`,
        refCode: `eng-stk-ref-${id}`,
        scadiumBalance: 1_000_000_000_000n, // 1,000 SCAD spendable
      },
    });
    userId = u.id;
  });

  afterAll(async () => {
    // distribute() pays EVERY staked user in the shared test DB, so the round can
    // hold claims beyond this suite's user — delete all of the period's claims
    // before the rounds (FK) so teardown is robust regardless of who got paid.
    const rounds = await prisma.distributionRound.findMany({
      where: { period },
      select: { id: true },
    });
    await prisma.distributionClaim.deleteMany({
      where: { roundId: { in: rounds.map((r) => r.id) } },
    });
    await prisma.distributionRound.deleteMany({ where: { period } });
    await prisma.stakeEvent.deleteMany({ where: { userId } });
    await prisma.balanceLedger.deleteMany({ where: { userId } });
    await prisma.bet.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('stakes $SCAD: spendable → staked, lock set', async () => {
    const amount = 500_000_000_000n; // 500 SCAD
    await staking.stake(userId, amount);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.scadiumStaked).toBe(amount);
    expect(u.scadiumBalance).toBe(500_000_000_000n);
    expect(u.stakeLockedUntil).not.toBeNull();
    expect(u.stakeLockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects unstake while locked', async () => {
    await expect(staking.unstake(userId, 1_000_000_000n)).rejects.toThrow(/locked/i);
  });

  it('distributes a USDS dividend pro-rata to the staker', async () => {
    // 1 SOL-equivalent NGR in this round's hour → 10% dividend = $10 USDS.
    await prisma.bet.create({
      data: {
        userId,
        gameType: 'crash',
        amountLamports: 1_000_000_000n,
        payoutLamports: 0n,
        status: 'lost',
        createdAt: new Date(hourStart.getTime() + 5 * 60_000),
      },
    });

    const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).usdsBalance;
    await distribution.distribute();

    const round = await prisma.distributionRound.findUniqueOrThrow({ where: { period } });
    expect(round.distributed).toBe(true);
    expect(round.poolUsds).toBeGreaterThan(0n);

    const claim = await prisma.distributionClaim.findFirst({
      where: { userId, roundId: round.id },
    });
    expect(claim).not.toBeNull();
    expect(claim!.shareUsds).toBeGreaterThan(0n);

    const after = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).usdsBalance;
    expect(after - before).toBe(claim!.shareUsds);
    expect(after).toBeGreaterThan(before);
  });

  it('re-running the same round pays nothing twice (idempotent)', async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).usdsBalance;
    await distribution.distribute();
    const after = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).usdsBalance;
    expect(after).toBe(before);
    const claims = await prisma.distributionClaim.count({ where: { userId } });
    expect(claims).toBe(1);
  });

  it('uses the configured 10% dividend slice', () => {
    expect(ENGINE.DIVIDEND_NGR_BPS).toBe(1000);
  });
});
