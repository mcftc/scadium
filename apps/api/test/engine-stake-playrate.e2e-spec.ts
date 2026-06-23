import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { stakePlayRate } from '@scadium/shared';
import { BlockMiningService } from '../src/engine/block-mining.service';
import { periodForHour } from '../src/queue/queue.constants';
import { prisma } from './engine-harness';

/**
 * Engine v2 E6 — staking is PASSIVE play-rate: "$SCAD savers keep mining" even
 * when they don't play. A staker with zero hourly wager must still receive a
 * block share (and draw weight) proportional to their stake, and `minerState`
 * must report them as mining passively.
 */
const E9 = 1_000_000_000n;

describe('Engine v2 staking as passive play-rate (integration, real Postgres)', () => {
  let svc: BlockMiningService;

  beforeAll(async () => {
    await prisma.$connect();
    svc = new BlockMiningService(prisma as never);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a staker with no hourly wager still mines a block share from their stake', async () => {
    const period = periodForHour(Date.now() - 60_000);
    const stale = await prisma.engineBlock.findUnique({ where: { period } });
    if (stale) {
      await prisma.engineBlockShare.deleteMany({ where: { blockId: stale.id } });
      await prisma.engineBlock.delete({ where: { id: stale.id } });
    }

    // A staker (no bet this hour) + an active bettor (so the hour has play).
    const stakedScad = 1_000_000n * E9; // 1M $SCAD held
    const sid = randomUUID();
    const staker = await prisma.user.create({
      data: {
        walletAddress: `stk-${sid}`,
        refCode: `stk-${sid}`,
        scadiumBalance: 0n,
        scadiumStaked: stakedScad,
      },
    });
    const bid = randomUUID();
    const bettor = await prisma.user.create({
      data: { walletAddress: `bet-${bid}`, refCode: `bet-${bid}`, scadiumBalance: 0n },
    });
    await prisma.bet.create({
      data: {
        userId: bettor.id,
        gameType: 'crash',
        amountLamports: 50n * E9,
        payoutLamports: 0n,
        status: 'lost',
        createdAt: new Date(Date.now() - 60_000),
      },
    });

    await svc.mineBlock();
    const block = await prisma.engineBlock.findUniqueOrThrow({ where: { period } });

    // The staker got a share row weighted by their passive play-rate.
    const share = await prisma.engineBlockShare.findUnique({
      where: { blockId_userId: { blockId: block.id, userId: staker.id } },
    });
    expect(share).not.toBeNull();
    expect(share!.playRate).toBe(stakePlayRate(stakedScad));
    expect(share!.shareScad).toBeGreaterThan(0n);

    // And they were credited that $SCAD despite never playing.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: staker.id } });
    expect(after.scadiumBalance).toBeGreaterThanOrEqual(share!.shareScad);
  });

  it('minerState reports a non-playing staker as mining passively', async () => {
    const sid = randomUUID();
    const staker = await prisma.user.create({
      data: {
        walletAddress: `stk2-${sid}`,
        refCode: `stk2-${sid}`,
        scadiumStaked: 500_000n * E9,
      },
    });
    const me = await svc.minerState(staker.id);
    expect(me.activePlayRate).toBe('0'); // no wager this hour
    expect(BigInt(me.stakePlayRate)).toBe(stakePlayRate(500_000n * E9));
    expect(BigInt(me.playRate)).toBe(stakePlayRate(500_000n * E9));
    expect(me.mining).toBe(true);
    expect(me.miningPassively).toBe(true);
  });
});
