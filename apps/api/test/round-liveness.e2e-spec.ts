import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { JACKPOT } from '@scadium/shared';
import { CrashEngine } from '../src/games/crash/crash.engine';
import { JackpotEngine } from '../src/games/jackpot/jackpot.engine';
import { prisma, makeUser, makeSeed, gw, offChain, pow, affiliatesStub } from './engine-harness';

/**
 * Round-loop liveness (four-games hardening A3/A4/A6/C2). Every case drives a
 * real engine against real Postgres; retries run on the millisecond backoff the
 * integration config sets (SETTLE_RETRY_BASE_MS=10).
 */

type Priv = Record<string, unknown> & { current: Record<string, unknown> };
const priv = (engine: unknown) => engine as Priv;
const call = <T = unknown>(engine: unknown, method: string, ...args: unknown[]) =>
  (priv(engine)[method] as (...a: unknown[]) => Promise<T>).apply(engine, args);

/** Poll until `check` holds (or fail after `ms`). */
async function eventually(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not reached in time');
}

function liveBet(userId: string, stake: bigint) {
  return {
    userId,
    username: null,
    walletAddress: `w-${userId}`,
    amountLamports: stake,
    originalAmountLamports: stake,
    payoutLamports: 0n,
    autoCashout: null,
    cashedOutAt: null,
  };
}

describe('round-loop liveness (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('crash: a settle that fails every retry hands the round to recovery and the game carries on', async () => {
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });
    const engine = new CrashEngine(prisma as never, gw(), offChain, pow());
    priv(engine).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      bustPoint: 2,
      phase: 'running',
      startedAt: Date.now(),
      waitingStartedAt: null,
      // A bet for a user that does not exist: every settle attempt fails.
      bets: new Map([[randomUUID(), liveBet(randomUUID(), 1_000n)]]),
      targetSlot: null,
      exposure: null,
    };
    try {
      await call(engine, 'bust');

      // Before: the loop stopped here until a restart. Now recovery closed the
      // round and a fresh one is open.
      expect((await prisma.crashRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
        'busted',
      );
      expect(engine.currentRoundId()).not.toBe(round.id);
      expect(engine.snapshot().phase).toBe('waiting');
      expect(
        await prisma.settlementFailure.count({ where: { gameType: 'crash', roundId: round.id } }),
      ).toBe(1);
    } finally {
      await engine.onModuleDestroy();
    }
  });

  it('crash: shutdown drains — the round in flight busts and settles, no bets, no new round', async () => {
    const prev = process.env.CRASH_DRAIN_TIMEOUT_MS;
    process.env.CRASH_DRAIN_TIMEOUT_MS = '15000';
    const since = new Date();
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'waiting' },
    });
    const player = await makeUser(0n);
    await prisma.crashBet.create({
      data: {
        roundId: round.id,
        userId: player.id,
        amountLamports: 1_000n,
        remainingLamports: 1_000n,
        payoutLamports: 0n,
        won: false,
      },
    });
    const engine = new CrashEngine(prisma as never, gw(), offChain, pow());
    priv(engine).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      bustPoint: 1.05, // busts ~200ms into the run
      phase: 'waiting',
      startedAt: null,
      waitingStartedAt: Date.now(),
      bets: new Map([[player.id, liveBet(player.id, 1_000n)]]),
      targetSlot: null,
      exposure: null,
    };
    try {
      await call(engine, 'beginRun');
      await engine.onModuleDestroy(); // SIGTERM path: waits for the round

      expect((await prisma.crashRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
        'busted',
      );
      // Settled by the live path (a Bet row), not voided by recovery.
      const bet = await prisma.bet.findFirstOrThrow({ where: { userId: player.id } });
      expect(bet.resultJson).toMatchObject({ bustPoint: 1.05 });
      // Nothing new was opened after the last round.
      expect(
        await prisma.crashRound.count({ where: { createdAt: { gte: since }, id: { not: round.id } } }),
      ).toBe(0);
      // And a bet during the drain is refused with a clear message.
      expect(() =>
        engine.placeBet({
          userId: randomUUID(),
          username: null,
          walletAddress: 'w',
          amountLamports: 1_000n,
          autoCashout: null,
        }),
      ).toThrow(/restarting/);
    } finally {
      if (prev === undefined) delete process.env.CRASH_DRAIN_TIMEOUT_MS;
      else process.env.CRASH_DRAIN_TIMEOUT_MS = prev;
    }
  });

  it('jackpot: the clock starts with players — solo deadline on the 1st, countdown on the 2nd', async () => {
    await prisma.jackpotRound.updateMany({ where: { status: 'open' }, data: { status: 'refunded' } });
    const engine = new JackpotEngine(prisma as never, gw(), offChain, pow(), affiliatesStub());
    try {
      await call(engine, 'bootRounds');
      const roundId = engine.meta().roundId;
      expect(engine.meta().closeAt).toBeNull(); // waiting: no clock, no timer
      expect((await prisma.jackpotRound.findUniqueOrThrow({ where: { id: roundId } })).closeAt).toBeNull();

      const enter = (userId: string) =>
        engine.onEntry({ roundId, userId, username: null, walletAddress: 'w', amountLamports: 1n });

      let t = Date.now();
      await enter(randomUUID());
      const solo = engine.meta().closeAt!;
      expect(solo).toBeGreaterThanOrEqual(t + JACKPOT.SOLO_WAIT_MS);
      expect(solo).toBeLessThan(Date.now() + JACKPOT.SOLO_WAIT_MS + 1_000);

      t = Date.now();
      await enter(randomUUID());
      const countdown = engine.meta().closeAt!;
      expect(countdown).toBeGreaterThanOrEqual(t + JACKPOT.ROUND_WINDOW_MS);
      expect(countdown).toBeLessThan(Date.now() + JACKPOT.ROUND_WINDOW_MS + 1_000);
      // Persisted, so a restart resumes the same deadline.
      expect(
        (await prisma.jackpotRound.findUniqueOrThrow({ where: { id: roundId } })).closeAt!.getTime(),
      ).toBe(countdown);
    } finally {
      await engine.onModuleDestroy();
    }
  });

  it('jackpot: a boot resumes a round that is still counting down instead of drawing it early', async () => {
    await prisma.jackpotRound.updateMany({ where: { status: 'open' }, data: { status: 'refunded' } });
    const seed = await makeSeed();
    const closeAt = new Date(Date.now() + 30_000);
    const round = await prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'open', closeAt },
    });
    const [a, b] = [await makeUser(0n), await makeUser(0n)];
    for (const u of [a, b]) {
      await prisma.jackpotEntry.create({
        data: { roundId: round.id, userId: u.id, amountLamports: 2_000_000n },
      });
    }
    const engine = new JackpotEngine(prisma as never, gw(), offChain, pow(), affiliatesStub());
    try {
      expect(await call(engine, 'recoverStrandedRounds')).toBe(true);
      expect((await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
        'open',
      );
      const meta = engine.meta();
      expect(meta.roundId).toBe(round.id);
      expect(meta.closeAt).toBe(closeAt.getTime());
      expect(meta.playerCount).toBe(2);
      expect(meta.totalLamports).toBe('4000000');
    } finally {
      await engine.onModuleDestroy();
    }
  });

  it('jackpot: a draw that fails every retry is refunded instead of freezing the game', async () => {
    const seed = await makeSeed();
    const round = await prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'open', closeAt: new Date(Date.now() - 1_000) },
    });
    const [a, b] = [await makeUser(0n), await makeUser(0n)];
    for (const u of [a, b]) {
      await prisma.jackpotEntry.create({
        data: { roundId: round.id, userId: u.id, amountLamports: 1_000_000n },
      });
    }
    // The draw path accrues wager volume; the refund path does not. A failing
    // accrue therefore breaks every DRAW attempt but lets the refund through.
    const failingPow = {
      accrue: async () => {
        throw new Error('induced draw failure');
      },
    } as never;
    const engine = new JackpotEngine(prisma as never, gw(), offChain, failingPow, affiliatesStub());
    priv(engine).recovering = true; // no follow-up round in this case
    priv(engine).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      closeAt: Date.now() - 1_000,
      status: 'open',
      totalLamports: 2_000_000n,
      players: new Set([a.id, b.id]),
    };
    try {
      expect(await call(engine, 'drawAndSettle')).toBe(false); // first attempt fails

      await eventually(
        async () =>
          (await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } })).status ===
          'refunded',
      );
      for (const u of [a, b]) {
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports,
        ).toBe(1_000_000n);
      }
      // One dead-letter for the round, not one per attempt.
      expect(
        await prisma.settlementFailure.count({ where: { gameType: 'jackpot', roundId: round.id } }),
      ).toBe(1);
    } finally {
      await engine.onModuleDestroy();
    }
  });
});
