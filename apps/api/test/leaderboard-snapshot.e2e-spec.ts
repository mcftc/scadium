import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service';
import { prisma } from './engine-harness';

/**
 * Issue #11 — the worker materializes windowed leaderboards into
 * `LeaderboardSnapshot` (the table was never written before). A snapshot must
 * capture the current top-by-volume ranking with correct `rank` ordering.
 */
describe('LeaderboardService.snapshot (issue #11)', () => {
  const svc = new LeaderboardService(prisma as never);
  const userIds: string[] = [];
  // Distinct, large volumes so this test's users dominate the top ranks
  // regardless of other rows already in the shared test DB.
  const volumes = [9_000_000_000_000n, 8_000_000_000_000n, 7_000_000_000_000n];

  beforeAll(async () => {
    for (const v of volumes) {
      const id = randomUUID();
      const u = await prisma.user.create({
        data: {
          walletAddress: `lb-${id}`,
          refCode: `lb-ref-${id}`,
          username: `lb-${id.slice(0, 8)}`,
          totalWagered: v,
          totalWon: v / 2n,
        },
      });
      userIds.push(u.id);
    }
  });

  it('writes a hourly snapshot batch with rank ordered by volume desc', async () => {
    const written = await svc.snapshot('hourly', 100);
    expect(written).toBeGreaterThanOrEqual(3);

    const latest = await svc.latestSnapshot('hourly');
    // Scope to OUR users (the shared test DB may hold other high-volume rows):
    // they must appear in descending-volume order with strictly increasing rank.
    const mine = latest.filter((r) => userIds.includes(r.userId));
    expect(mine.map((r) => r.userId)).toEqual(userIds);
    expect(mine.map((r) => r.volumeLamports)).toEqual(volumes);
    const myRanks = mine.map((r) => r.rank);
    expect(myRanks).toEqual([...myRanks].sort((a, b) => a - b));
    // Ranks are globally unique + strictly increasing across the whole batch.
    const ranks = latest.map((r) => r.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
