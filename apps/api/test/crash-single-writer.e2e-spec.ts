import { describe, it, expect, afterAll } from 'vitest';
import IORedis from 'ioredis';
import { CrashEngine } from '../src/games/crash/crash.engine';
import { prisma, gw, offChain, pow } from './engine-harness';

/**
 * Issue #85 — two CrashEngine instances sharing one Redis must elect a single
 * writer: only the leader creates `CrashRound` rows and drives the loop, and the
 * follower mirrors the leader's public round so both `snapshot()`s agree. Today
 * (no election) each instance starts its OWN round with a different id/bustPoint.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('crash single-writer leader election (issue #85)', () => {
  const r1 = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const r2 = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
  let a: CrashEngine;
  let b: CrashEngine;

  afterAll(async () => {
    await a?.onModuleDestroy?.();
    await b?.onModuleDestroy?.();
    await Promise.all([r1.quit(), r2.quit()]).catch(() => undefined);
  });

  it('only the leader writes rounds; the follower mirrors the same round', async () => {
    await r1.del('lock:engine:crash', 'round:crash:current');

    a = new CrashEngine(prisma as never, gw(), offChain, pow(), { client: r1 } as never);
    b = new CrashEngine(prisma as never, gw(), offChain, pow(), { client: r2 } as never);
    await a.onModuleInit();
    await b.onModuleInit();

    // Wait for: exactly one leader + the leader created a round + the follower
    // mirrored it (both snapshots carry the same non-empty roundId).
    const deadline = Date.now() + 9_000;
    while (Date.now() < deadline) {
      const split = a.isLeader() !== b.isLeader();
      const rids = [a.snapshot().roundId, b.snapshot().roundId];
      if (split && rids[0] && rids[0] === rids[1]) break;
      await sleep(150);
    }

    // Exactly one leader.
    expect(a.isLeader()).toBe(!b.isLeader());
    const leader = a.isLeader() ? a : b;
    const follower = a.isLeader() ? b : a;

    const rid = leader.snapshot().roundId;
    expect(rid).not.toBe('');
    // The follower serves the LEADER's round — proof it did not start its own
    // (a self-started round would carry a different id).
    expect(follower.snapshot().roundId).toBe(rid);
    // The single round exists in the DB.
    const row = await prisma.crashRound.findUnique({ where: { id: rid } });
    expect(row).not.toBeNull();
    // Both report the same provably-fair commitment for that round.
    expect(follower.snapshot().serverSeedHash).toBe(leader.snapshot().serverSeedHash);
  });
});
