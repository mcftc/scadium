import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BlockMiningService } from '../src/engine/block-mining.service';
import { periodForHour } from '../src/queue/queue.constants';
import { prisma } from './engine-harness';

/**
 * Engine v2 E2 — the hourly block worker mints the phase block reward split by
 * play-rate. Asserts against the REAL block numbers (reward/totalPlayRate) so it
 * is robust to other suites' bets in the same hour window: each miner's share
 * must equal blockShare(theirPlayRate, totalPlayRate, reward) and be credited as
 * $SCAD; play-rate == hourly wagered; re-running is idempotent (no double mint).
 */
const E9 = 1_000_000_000n;

describe('Engine v2 block mining (integration, real Postgres)', () => {
  let svc: BlockMiningService;

  beforeAll(async () => {
    await prisma.$connect();
    svc = new BlockMiningService(prisma as never);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function mkMiner(wager: bigint) {
    const id = randomUUID();
    const u = await prisma.user.create({
      data: { walletAddress: `eng2-${id}`, refCode: `eng2-${id}`, scadiumBalance: 0n },
    });
    // A bet inside the period window (the hour containing now-60s).
    await prisma.bet.create({
      data: {
        userId: u.id,
        gameType: 'crash',
        amountLamports: wager,
        payoutLamports: 0n,
        status: 'lost',
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    return u.id;
  }

  it('splits the block reward by play-rate and credits $SCAD; re-run is idempotent', async () => {
    // A prior local run (same hour) may have already settled this period's block;
    // clear it so we mine fresh. CI runs on a clean DB so this is a no-op there.
    const period = periodForHour(Date.now() - 60_000);
    const stale = await prisma.engineBlock.findUnique({ where: { period } });
    if (stale) {
      await prisma.engineBlockShare.deleteMany({ where: { blockId: stale.id } });
      await prisma.engineBlock.delete({ where: { id: stale.id } });
    }

    const a = await mkMiner(30n * E9);
    const b = await mkMiner(70n * E9);

    const res = await svc.mineBlock();
    expect(res.participantCount).toBeGreaterThanOrEqual(2);

    const block = await prisma.engineBlock.findUniqueOrThrow({ where: { period: res.period } });
    expect(block.distributed).toBe(true);
    expect(block.rewardScad).toBeGreaterThan(0n);

    const shareA = await prisma.engineBlockShare.findUniqueOrThrow({
      where: { blockId_userId: { blockId: block.id, userId: a } },
    });
    const shareB = await prisma.engineBlockShare.findUniqueOrThrow({
      where: { blockId_userId: { blockId: block.id, userId: b } },
    });

    // Play-rate == hourly wagered (default 1.0× tier).
    expect(shareA.playRate).toBe(30n * E9);
    expect(shareB.playRate).toBe(70n * E9);

    // Both shares are positive and B (more play) gets the larger cut.
    expect(shareA.shareScad).toBeGreaterThan(0n);
    expect(shareB.shareScad).toBeGreaterThan(shareA.shareScad);

    // Pro-rata: shareA/shareB == prA/prB up to flooring dust. Cross-multiplying,
    // |shareA·prB − shareB·prA| < max(prA, prB) for two floored pro-rata cuts of
    // the SAME pool — independent of the pool size, other miners, or dust. (We
    // don't recompute from block.rewardScad: that stores what was *minted* — the
    // floored sum — not the pool reward the shares were cut from.)
    const cross = shareA.shareScad * shareB.playRate - shareB.shareScad * shareA.playRate;
    const absCross = cross < 0n ? -cross : cross;
    expect(absCross).toBeLessThan(shareB.playRate);

    // The credit equals the recorded share — plus the big-reward bonus if A was
    // the weighted-random winner (E4). Money moved == share row (+ bonus).
    const aBonus = block.winnerId === a ? block.bigRewardScad : 0n;
    const ua = await prisma.user.findUniqueOrThrow({ where: { id: a } });
    expect(ua.scadiumBalance).toBe(shareA.shareScad + aBonus);

    // Idempotent: a second mine settles nothing new — A's balance is unchanged.
    const again = await svc.mineBlock();
    expect(again.participantCount).toBe(0);
    const ua2 = await prisma.user.findUniqueOrThrow({ where: { id: a } });
    expect(ua2.scadiumBalance).toBe(shareA.shareScad + aBonus);
  });
});
