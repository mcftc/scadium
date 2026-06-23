import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ENGINE } from '@scadium/shared';
import { BlockMiningService } from '../src/engine/block-mining.service';
import { periodForHour } from '../src/queue/queue.constants';
import { prisma } from './engine-harness';

/**
 * Engine v2 E5 — the read API surfaces mining observability. Verifies the
 * service methods the controller exposes (`state` / `minerState` /
 * `currentLeaderboard` / `recentBlocks`) return correct shapes + values against
 * real mined data.
 */
const E9 = 1_000_000_000n;

const mkBettor = async (wager: bigint, at: Date) => {
  const id = randomUUID();
  const u = await prisma.user.create({
    data: { walletAddress: `read-${id}`, refCode: `read-${id}`, scadiumBalance: 0n },
  });
  await prisma.bet.create({
    data: {
      userId: u.id,
      gameType: 'crash',
      amountLamports: wager,
      payoutLamports: 0n,
      status: 'lost',
      createdAt: at,
    },
  });
  return u.id;
};

describe('Engine v2 read API (integration, real Postgres)', () => {
  let svc: BlockMiningService;

  beforeAll(async () => {
    await prisma.$connect();
    svc = new BlockMiningService(prisma as never);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('state() reports phase, emission, the current block reward, and the last block', async () => {
    // Mine a block so there is emission + a settled block to report.
    const period = periodForHour(Date.now() - 60_000);
    const stale = await prisma.engineBlock.findUnique({ where: { period } });
    if (stale) {
      await prisma.engineBlockShare.deleteMany({ where: { blockId: stale.id } });
      await prisma.engineBlock.delete({ where: { id: stale.id } });
    }
    await mkBettor(40n * E9, new Date(Date.now() - 60_000));
    await svc.mineBlock();

    const state = await svc.state();
    expect(state.phase).toBeGreaterThanOrEqual(1);
    expect(BigInt(state.totalEmittedScad)).toBeGreaterThan(0n);
    expect(BigInt(state.remainingPoolScad)).toBeGreaterThan(0n);
    expect(BigInt(state.currentBlockRewardScad)).toBeGreaterThan(0n);
    expect(state.bigRewardBps).toBe(ENGINE.BIG_REWARD_BPS);
    expect(state.msToNextDistribution).toBeGreaterThan(0);
    expect(state.msToNextDistribution).toBeLessThanOrEqual(3_600_000);
    expect(state.lastBlock).not.toBeNull();
    expect(state.lastBlock!.period).toBe(period);
  });

  it('minerState() reflects a current-hour wager + projects a positive share', async () => {
    const uid = await mkBettor(10n * E9, new Date()); // current hour
    const me = await svc.minerState(uid);
    expect(BigInt(me.playRate)).toBe(10n * E9); // active play-rate == wagered
    expect(me.mining).toBe(true);
    expect(BigInt(me.totalPlayRate)).toBeGreaterThanOrEqual(10n * E9);
    expect(BigInt(me.projectedShareScad)).toBeGreaterThan(0n);
    expect(me.shareBps).toBeGreaterThan(0);
  });

  it('currentLeaderboard() ranks miners by play-rate (desc)', async () => {
    await mkBettor(80n * E9, new Date());
    const lb = await svc.currentLeaderboard(10);
    expect(lb.miners.length).toBeGreaterThanOrEqual(1);
    // Ranks are 1..n and play-rates are non-increasing.
    for (let i = 1; i < lb.miners.length; i += 1) {
      expect(lb.miners[i]!.rank).toBe(i + 1);
      expect(BigInt(lb.miners[i]!.playRate)).toBeLessThanOrEqual(
        BigInt(lb.miners[i - 1]!.playRate),
      );
    }
  });

  it('recentBlocks() returns settled blocks with their proof fields', async () => {
    const blocks = await svc.recentBlocks(5);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const b = blocks[0]!;
    expect(b.period).toMatch(/^\d{10}$/);
    expect(BigInt(b.rewardScad)).toBeGreaterThan(0n);
    expect(b.drawSeedHash).not.toBeNull();
  });
});
