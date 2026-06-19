import { describe, it, expect, afterAll } from 'vitest';
import IORedis from 'ioredis';
import { JackpotEngine } from '../src/games/jackpot/jackpot.engine';
import { LotteryEngine } from '../src/games/lottery/lottery.engine';
import { BlackjackEngine } from '../src/games/blackjack/blackjack.engine';
import { prisma, gw, offChain, pow } from './engine-harness';

/**
 * Issue #86 — two instances of each engine sharing one Redis must elect a single
 * writer: only the leader opens rounds/draws/creates the Main Table, so booting N
 * replicas produces NO duplicate JackpotRound / LotteryDraw / BlackjackTable rows.
 * Without election each instance starts its own (a row per replica).
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redis = (c: IORedis) => ({ client: c }) as never;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForLeader(a: { isLeader(): boolean }, b: { isLeader(): boolean }) {
  const deadline = Date.now() + 9_000;
  while (Date.now() < deadline) {
    if (a.isLeader() !== b.isLeader()) return;
    await sleep(150);
  }
}

describe('game engines single-writer leader election (issue #86)', () => {
  const r1 = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const r2 = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const destroyers: Array<() => Promise<void>> = [];

  afterAll(async () => {
    for (const d of destroyers) await d().catch(() => undefined);
    await Promise.all([r1.quit(), r2.quit()]).catch(() => undefined);
  });

  it('jackpot: only the leader opens a round', async () => {
    await r1.del('lock:engine:jackpot');
    const since = new Date();
    const a = new JackpotEngine(prisma as never, gw(), offChain, pow(), redis(r1));
    const b = new JackpotEngine(prisma as never, gw(), offChain, pow(), redis(r2));
    destroyers.push(() => a.onModuleDestroy(), () => b.onModuleDestroy());
    await Promise.all([a.onModuleInit(), b.onModuleInit()]);
    await waitForLeader(a, b);
    // Give the leader a beat to write its round.
    for (let i = 0; i < 40; i++) {
      if ((await prisma.jackpotRound.count({ where: { createdAt: { gte: since } } })) >= 1) break;
      await sleep(150);
    }
    expect(a.isLeader()).toBe(!b.isLeader());
    expect(await prisma.jackpotRound.count({ where: { createdAt: { gte: since } } })).toBe(1);
  });

  it('lottery: only the leader opens a draw', async () => {
    await r1.del('lock:engine:lottery');
    const since = new Date();
    const a = new LotteryEngine(prisma as never, gw(), offChain, pow(), redis(r1));
    const b = new LotteryEngine(prisma as never, gw(), offChain, pow(), redis(r2));
    destroyers.push(() => a.onModuleDestroy(), () => b.onModuleDestroy());
    await Promise.all([a.onModuleInit(), b.onModuleInit()]);
    await waitForLeader(a, b);
    for (let i = 0; i < 40; i++) {
      if ((await prisma.lotteryDraw.count({ where: { createdAt: { gte: since } } })) >= 1) break;
      await sleep(150);
    }
    expect(a.isLeader()).toBe(!b.isLeader());
    expect(await prisma.lotteryDraw.count({ where: { createdAt: { gte: since } } })).toBe(1);
  });

  it('blackjack: only the leader creates the Main Table', async () => {
    await r1.del('lock:engine:blackjack');
    const since = new Date();
    const a = new BlackjackEngine(prisma as never, gw(), offChain, pow(), redis(r1));
    const b = new BlackjackEngine(prisma as never, gw(), offChain, pow(), redis(r2));
    destroyers.push(() => a.onModuleDestroy(), () => b.onModuleDestroy());
    await Promise.all([a.onModuleInit(), b.onModuleInit()]);
    await waitForLeader(a, b);
    for (let i = 0; i < 40; i++) {
      const n = await prisma.blackjackTable.count({
        where: { name: 'Main Table', createdAt: { gte: since } },
      });
      if (n >= 1) break;
      await sleep(150);
    }
    expect(a.isLeader()).toBe(!b.isLeader());
    expect(
      await prisma.blackjackTable.count({ where: { name: 'Main Table', createdAt: { gte: since } } }),
    ).toBe(1);
  });
});
