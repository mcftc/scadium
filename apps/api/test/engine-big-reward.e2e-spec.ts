import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sha256 } from '@scadium/fair';
import { ENGINE } from '@scadium/shared';
import { BlockMiningService } from '../src/engine/block-mining.service';
import { periodForHour } from '../src/queue/queue.constants';
import { prisma } from './engine-harness';

/**
 * Engine v2 E4 — each block routes a BIG_REWARD_BPS slice to ONE
 * play-rate-weighted RANDOM winner (equal-chance sweepstakes). Asserts the
 * integration wiring: the winner is a real participant, receives the big reward
 * ON TOP of their pro-rata share, and the block stores a reproducible proof
 * (revealed seed + its hash). The weighting/reproducibility of the pick itself
 * is unit-tested in @scadium/fair (engine-draw).
 */
const E9 = 1_000_000_000n;

describe('Engine v2 big-reward draw (integration, real Postgres)', () => {
  let svc: BlockMiningService;

  beforeAll(async () => {
    await prisma.$connect();
    svc = new BlockMiningService(prisma as never);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('awards the big-reward slice to a weighted-random participant with a stored proof', async () => {
    const period = periodForHour(Date.now() - 60_000);
    const stale = await prisma.engineBlock.findUnique({ where: { period } });
    if (stale) {
      await prisma.engineBlockShare.deleteMany({ where: { blockId: stale.id } });
      await prisma.engineBlock.delete({ where: { id: stale.id } });
    }

    // Several miners with substantial (non-dust) play-rate this hour.
    const ids: string[] = [];
    for (const wager of [20n * E9, 30n * E9, 50n * E9]) {
      const id = randomUUID();
      const u = await prisma.user.create({
        data: { walletAddress: `big-${id}`, refCode: `big-${id}`, scadiumBalance: 0n },
      });
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
      ids.push(u.id);
    }

    await svc.mineBlock();
    const block = await prisma.engineBlock.findUniqueOrThrow({ where: { period } });

    // A winner was drawn and given a positive big reward.
    expect(block.winnerId).not.toBeNull();
    expect(block.bigRewardScad).toBeGreaterThan(0n);

    // The big reward is the configured slice of the block pool: with rewardScad =
    // splitDistributed + bigReward, bigReward ≈ BIG_REWARD_BPS of the gross pool.
    // (Exact gross isn't stored; assert the slice is the expected fraction of the
    // reconstructed gross = split shares + bigReward, within flooring dust.)
    const shares = await prisma.engineBlockShare.findMany({ where: { blockId: block.id } });
    const splitDistributed = shares.reduce((a, s) => a + s.shareScad, 0n);
    const gross = splitDistributed + block.bigRewardScad;
    const expectedBig = (gross * BigInt(ENGINE.BIG_REWARD_BPS)) / 10_000n;
    const diff = block.bigRewardScad - expectedBig;
    expect(diff < 0n ? -diff : diff).toBeLessThan(BigInt(shares.length) + 2n);

    // The proof is stored and consistent: drawSeedHash == sha256(drawSeed).
    expect(block.drawSeed).not.toBeNull();
    expect(block.drawSeedHash).toBe(sha256(block.drawSeed!));

    // The winner got the big reward as a distinct `big_reward` ledger credit
    // (authoritative — robust to the winner being any weighted participant).
    const bigLedger = await prisma.balanceLedger.findFirst({
      where: { userId: block.winnerId!, currency: 'scad', reason: 'big_reward', refId: block.id },
    });
    expect(bigLedger).not.toBeNull();
    expect(bigLedger!.delta).toBe(block.bigRewardScad);

    // The winner's balance reflects at least the big-reward bonus (plus any
    // pro-rata share they also earned).
    const winner = await prisma.user.findUniqueOrThrow({ where: { id: block.winnerId! } });
    expect(winner.scadiumBalance).toBeGreaterThanOrEqual(block.bigRewardScad);
  });
});
