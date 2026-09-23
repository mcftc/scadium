import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomInt } from 'node:crypto';
import { beaconRoundAfter, CRASH } from '@scadium/shared';
import {
  crashPointFromSlot,
  jackpotTicketFromEntropy,
  lotteryDraw,
  padClientSeed32,
} from '@scadium/fair';
import { CrashEngine } from '../src/games/crash/crash.engine';
import { JackpotEngine } from '../src/games/jackpot/jackpot.engine';
import { LotteryEngine } from '../src/games/lottery/lottery.engine';
import { prisma, makeUser, makeSeed, gw, offChain, pow, affiliatesStub } from './engine-harness';

/**
 * ADR 0004 — results fold in a public drand beacon value published only after
 * bets/entries/sales close, so the operator can no longer know them in advance.
 * Real Postgres; the beacon is a stub (the suite must not need the internet):
 * `ok` serves a fixed value, `down` never answers.
 */

// A real drand quicknet value, reused as the stub's answer.
const HEX = '542fb4b05b26aa2a127d481500422d502c620e6ed7b11a8c58ff4f22e7633ca2';
const ok = { enabled: true, roundAfter: beaconRoundAfter, randomness: async () => HEX };
const down = { enabled: true, roundAfter: beaconRoundAfter, randomness: async () => null };

type Priv = Record<string, unknown>;
const call = <T = unknown>(engine: unknown, method: string, ...args: unknown[]) =>
  ((engine as Priv)[method] as (...a: unknown[]) => Promise<T>).apply(engine, args);

describe('public randomness beacon (ADR 0004, integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lottery: digits come from the first beacon round after drawAt, recorded as drand', async () => {
    const seed = await makeSeed();
    const drawAt = Date.now() - 60_000;
    const draw = await prisma.lotteryDraw.create({
      data: {
        seedId: seed.id,
        nonce: 0,
        status: 'open',
        drawIndex: BigInt(randomInt(1, 2_000_000_000)),
        drawAt: new Date(drawAt),
      },
    });
    const engine = new LotteryEngine(
      prisma as never,
      gw(),
      offChain,
      pow(),
      affiliatesStub(),
      undefined,
      undefined,
      ok as never,
    );
    (engine as unknown as Priv).recovering = true;
    (engine as unknown as Priv).current = {
      id: draw.id,
      drawIndex: draw.drawIndex,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      drawAt,
      status: 'open',
      ticketCount: 0,
      ticketPriceScadBase: 0n,
      injectionScadBase: 0n,
      rolloverScadBase: 0n,
      salesScadBase: 0n,
      potLamports: 0n,
      commitTxSignature: null,
      targetSlot: null,
    };
    await call(engine, 'drawAndSettle');

    const after = await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: draw.id } });
    expect(after.fairness).toBe('drand-quicknet');
    expect(after.beaconRound).toBe(BigInt(beaconRoundAfter(drawAt)));
    expect(after.slotHash).toBe(HEX);
    expect(after.winningDigits).toEqual(
      lotteryDraw(seed.serverSeed!, padClientSeed32(seed.clientSeed), Buffer.from(HEX, 'hex'), 0)
        .digits,
    );
  });

  it('lottery: an unavailable beacon keeps the draw open and retries — no fallback', async () => {
    const seed = await makeSeed();
    const draw = await prisma.lotteryDraw.create({
      data: {
        seedId: seed.id,
        nonce: 0,
        status: 'open',
        drawIndex: BigInt(randomInt(1, 2_000_000_000)),
        drawAt: new Date(Date.now() - 60_000),
      },
    });
    const engine = new LotteryEngine(
      prisma as never,
      gw(),
      offChain,
      pow(),
      affiliatesStub(),
      undefined,
      undefined,
      down as never,
    );
    (engine as unknown as Priv).recovering = true;
    (engine as unknown as Priv).current = {
      id: draw.id,
      drawIndex: draw.drawIndex,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      drawAt: Date.now() - 60_000,
      status: 'open',
      ticketCount: 0,
      ticketPriceScadBase: 0n,
      injectionScadBase: 0n,
      rolloverScadBase: 0n,
      salesScadBase: 0n,
      potLamports: 0n,
      commitTxSignature: null,
      targetSlot: null,
    };
    try {
      expect(await call(engine, 'drawAndSettle')).toBe(false);
      expect((await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: draw.id } })).status).toBe(
        'open',
      );
      expect(
        await prisma.settlementFailure.count({ where: { gameType: 'lottery', roundId: draw.id } }),
      ).toBe(1);
    } finally {
      await engine.onModuleDestroy();
    }
  });

  it('jackpot: the winning ticket folds in the beacon round after closeAt', async () => {
    const seed = await makeSeed();
    const closeAt = Date.now() - 5_000;
    const round = await prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'open', closeAt: new Date(closeAt) },
    });
    const [a, b] = [await makeUser(0n), await makeUser(0n)];
    for (const u of [a, b]) {
      await prisma.jackpotEntry.create({
        data: { roundId: round.id, userId: u.id, amountLamports: 4_000_000n },
      });
    }
    const engine = new JackpotEngine(
      prisma as never,
      gw(),
      offChain,
      pow(),
      affiliatesStub(),
      undefined,
      undefined,
      undefined,
      ok as never,
    );
    (engine as unknown as Priv).recovering = true;
    (engine as unknown as Priv).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      closeAt,
      status: 'open',
      totalLamports: 8_000_000n,
      players: new Set([a.id, b.id]),
    };
    await call(engine, 'drawAndSettle');

    const after = await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(after.status).toBe('drawn');
    expect(after.beaconRound).toBe(BigInt(beaconRoundAfter(closeAt)));
    expect(after.slotHash).toBe(HEX);
    expect(after.winningTicket).toBe(
      jackpotTicketFromEntropy(
        seed.serverSeed!,
        seed.clientSeed,
        Buffer.from(HEX, 'hex'),
        0,
        8_000_000n,
      ),
    );
  });

  it('crash: the bust is derived from the pinned beacon round when betting closes', async () => {
    const engine = new CrashEngine(
      prisma as never,
      gw(),
      offChain,
      pow(),
      undefined,
      undefined,
      undefined,
      undefined,
      ok as never,
    );
    try {
      const before = Date.now();
      await call(engine, 'startNewRound');
      const snap = engine.snapshot();
      // Announced at round open, and published only after betting closes.
      expect(snap.beaconRound).toBeGreaterThanOrEqual(
        beaconRoundAfter(before + CRASH.BET_WINDOW_MS),
      );
      expect(snap.bustPoint).toBeNull();

      await call(engine, 'beginRun'); // the betting window ends
      const round = await prisma.crashRound.findUniqueOrThrow({
        where: { id: snap.roundId },
        include: { seed: true },
      });
      expect(round.beaconRound).toBe(BigInt(snap.beaconRound!));
      expect(round.slotHash).toBe(HEX);
      const current = (engine as unknown as { current: { bustPoint: number } }).current;
      expect(current.bustPoint).toBe(
        crashPointFromSlot(
          round.seed.serverSeed!,
          round.seed.clientSeed,
          Buffer.from(HEX, 'hex'),
          0,
        ),
      );
      // No bet can land once the window has closed, even before `running`.
      expect(() =>
        engine.placeBet({
          userId: 'x',
          username: null,
          walletAddress: 'w',
          amountLamports: 1n,
          autoCashout: null,
        }),
      ).toThrow(/closed/);
    } finally {
      await engine.onModuleDestroy();
    }
  });

  it('crash: no beacon in time → the round is voided and every stake refunded', async () => {
    const engine = new CrashEngine(
      prisma as never,
      gw(),
      offChain,
      pow(),
      undefined,
      undefined,
      undefined,
      undefined,
      down as never,
    );
    try {
      await call(engine, 'startNewRound');
      const roundId = engine.currentRoundId();
      const player = await makeUser(0n);
      await prisma.crashBet.create({
        data: {
          roundId,
          userId: player.id,
          amountLamports: 5_000n,
          remainingLamports: 5_000n,
          payoutLamports: 0n,
          won: false,
        },
      });

      await call(engine, 'beginRun');

      expect((await prisma.crashRound.findUniqueOrThrow({ where: { id: roundId } })).status).toBe(
        'busted',
      );
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: player.id } })).playBalanceLamports,
      ).toBe(5_000n); // refunded in full
      expect(engine.currentRoundId()).not.toBe(roundId); // and the game carried on
    } finally {
      await engine.onModuleDestroy();
    }
  });
});
