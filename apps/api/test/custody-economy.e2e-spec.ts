import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { JACKPOT, racePrizeLamports } from '@scadium/shared';
import { prisma, makeUser, makeSeed, makeLotteryEngine, offChain, gw } from './engine-harness';
import { economyOn, fund } from './custody-harness';
import { assertDepositedOnly, stillPlay } from '../src/custody/economy';
import { JackpotService } from '../src/games/jackpot/jackpot.service';
import { LotteryService } from '../src/games/lottery/lottery.service';
import { CoinflipService } from '../src/games/coinflip/coinflip.service';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import { AirdropEngine } from '../src/airdrop/airdrop.engine';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service';
import { AffiliatesService } from '../src/affiliates/affiliates.service';

/**
 * Play-money vs deposited SOL (ADR 0005, spec §7), each rule at its real call
 * site against real Postgres: free play-money must never reach a withdrawable
 * balance. With custody off every rule is a no-op.
 */

const SOL = 1_000_000_000n;
const rgStub = { assertCanWager: async () => undefined } as never;
const ENTRY = BigInt(JACKPOT.MIN_ENTRY_LAMPORTS);

async function funded(lamports = 10n * SOL) {
  const u = await makeUser(0n);
  await fund(u.id, lamports);
  return u;
}

async function openJackpotRound() {
  const seed = await makeSeed();
  const round = await prisma.jackpotRound.create({
    data: { seedId: seed.id, nonce: 0, status: 'open' },
  });
  const engine = { getOpenRound: () => ({ id: round.id }), onEntry: vi.fn(async () => undefined) };
  return { round, svc: new JackpotService(prisma as never, engine as never, rgStub) };
}

function coinflip() {
  return new CoinflipService(
    prisma as never,
    { emitCreated: vi.fn(), emitResolved: vi.fn(), emitCancelled: vi.fn() } as never,
    { enabled: false } as never,
    new SeedManagerService(prisma as never),
    rgStub,
    { creditReferral: async () => undefined } as never,
    { accrue: async () => 0n } as never,
  );
}

describe('custody economy rules (integration, real Postgres)', () => {
  let restore: (() => void) | null = null;
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterEach(() => {
    restore?.();
    restore = null;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('E1 jackpot: deposited funds only, and not into a round holding play entries', async () => {
    restore = economyOn();
    const { round, svc } = await openJackpotRound();
    const play = await makeUser(10n * SOL);
    await expect(svc.enter({ userId: play.id, amountLamports: ENTRY })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const real = await funded();
    await svc.enter({ userId: real.id, amountLamports: ENTRY });
    expect(await prisma.jackpotEntry.count({ where: { roundId: round.id } })).toBe(1);

    // A round left over from before custody, with a play entry in it.
    const leftover = await openJackpotRound();
    await prisma.jackpotEntry.create({
      data: { roundId: leftover.round.id, userId: play.id, amountLamports: ENTRY },
    });
    const other = await funded();
    await expect(
      leftover.svc.enter({ userId: other.id, amountLamports: ENTRY }),
    ).rejects.toThrow(/play-money entries/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).playBalanceLamports).toBe(
      10n * SOL,
    );
  });

  it('E1 lottery: tickets and free tickets need deposited funds; not into a play draw', async () => {
    restore = economyOn();
    const engine = makeLotteryEngine();
    const svc = new LotteryService(prisma as never, engine, offChain, rgStub);
    await prisma.lotteryDraw.updateMany({ where: { status: 'open' }, data: { status: 'drawn' } });
    await (engine as unknown as { openNewDraw: () => Promise<void> }).openNewDraw();
    try {
      const play = await makeUser(10n * SOL);
      await prisma.user.update({ where: { id: play.id }, data: { totalWagered: 5n * SOL } });
      await expect(
        svc.buyTickets({ userId: play.id, picks: [[1, 2, 3, 4, 5, 6]] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        svc.useFreeTicket({ userId: play.id, digits: [1, 2, 3, 4, 5, 6] }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const real = await funded();
      await svc.buyTickets({ userId: real.id, picks: [[1, 2, 3, 4, 5, 6]] });

      // The draw now gets a (pre-custody) play ticket: deposited buyers wait for the next draw.
      const drawId = engine.getOpenDraw()!.id;
      await prisma.lotteryTicket.create({
        data: { drawId, userId: play.id, digits: [9, 9, 9, 9, 9, 9], costLamports: 1n, costScadBase: 1n },
      });
      await expect(
        svc.buyTickets({ userId: real.id, picks: [[1, 2, 3, 4, 5, 6]] }),
      ).rejects.toThrow(/play-money entries/);
    } finally {
      await engine.onModuleDestroy();
    }
  });

  it('E2 coinflip: a flip is joined only from its creator’s economy', async () => {
    restore = economyOn();
    const svc = coinflip();
    const play = await makeUser(SOL);
    const flip = await svc.create({ userId: play.id, side: 'heads', amountLamports: SOL / 10n });

    const real = await funded();
    await expect(svc.join({ userId: real.id, gameId: flip.id })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const otherPlay = await makeUser(SOL);
    const done = await svc.join({ userId: otherPlay.id, gameId: flip.id });
    expect(done.status).toBe('completed');
  });

  it('E3 airdrop: only play accounts tip, and only play accounts share the pool', async () => {
    restore = economyOn();
    const rg = { assertCanWager: async () => undefined } as never;
    const engine = new AirdropEngine(prisma as never, gw(), rg);
    const real = await funded();
    await expect(engine.tip(real.id, SOL / 100n)).rejects.toBeInstanceOf(ForbiddenException);

    const play = await makeUser(SOL);
    const realAgeOk = await funded();
    await prisma.user.updateMany({
      where: { id: { in: [play.id, realAgeOk.id] } },
      data: { ageConfirmedAt: new Date() },
    });
    const eligible = await (
      engine as unknown as { filterEligibleForSybil: (ids: string[]) => Promise<string[]> }
    ).filterEligibleForSybil([play.id, realAgeOk.id]);
    expect(eligible).toEqual([play.id]);
  });

  it('E4 race: the play-money prize pool is ranked and paid among play accounts only', async () => {
    restore = economyOn();
    const day = '20250301';
    const at = new Date(Date.UTC(2025, 2, 1, 8));
    await prisma.raceResult.deleteMany({ where: { raceDay: day } });
    await prisma.bet.deleteMany({
      where: { createdAt: { gte: new Date(Date.UTC(2025, 2, 1)), lt: new Date(Date.UTC(2025, 2, 2)) } },
    });
    const real = await funded(0n);
    const play = await makeUser(0n);
    for (const [userId, amount] of [
      [real.id, 50n * SOL],
      [play.id, 5n * SOL],
    ] as const) {
      await prisma.bet.create({
        data: { userId, gameType: 'crash', amountLamports: amount, payoutLamports: 0n, status: 'lost', createdAt: at },
      });
    }
    await new LeaderboardService(prisma as never).settleRace(day);
    const results = await prisma.raceResult.findMany({ where: { raceDay: day } });
    expect(results.map((r) => r.userId)).toEqual([play.id]); // the deposited top wagerer is not in it
    expect((await prisma.user.findUniqueOrThrow({ where: { id: play.id } })).playBalanceLamports).toBe(
      racePrizeLamports(0),
    );
  });

  it('E5 affiliates: commission accrues only between accounts of the same economy', async () => {
    restore = economyOn();
    const aff = new AffiliatesService(prisma as never);
    const realReferrer = await funded();
    const playReferee = await makeUser(0n);
    await prisma.user.update({ where: { id: playReferee.id }, data: { referredById: realReferrer.id } });
    await prisma.$transaction((tx) => aff.creditReferral(tx, playReferee.id, SOL, 'coinflip'));
    const mixed = await prisma.referral.findUniqueOrThrow({ where: { refereeId: playReferee.id } });
    expect(mixed.volumeLamports).toBe(SOL); // tracked…
    expect(mixed.commissionLamports).toBe(0n); // …but earns nothing

    const realReferee = await funded();
    await prisma.user.update({ where: { id: realReferee.id }, data: { referredById: realReferrer.id } });
    await prisma.$transaction((tx) => aff.creditReferral(tx, realReferee.id, SOL, 'coinflip'));
    const same = await prisma.referral.findUniqueOrThrow({ where: { refereeId: realReferee.id } });
    expect(same.commissionLamports).toBeGreaterThan(0n);
  });

  it('with custody off, none of the rules apply (the play-money site as before)', async () => {
    const { svc } = await openJackpotRound();
    const play = await makeUser(10n * SOL);
    await svc.enter({ userId: play.id, amountLamports: ENTRY });
    const real = await funded();
    const engine = new AirdropEngine(prisma as never, gw(), rgStub);
    await expect(engine.tip(real.id, SOL / 100n)).resolves.toBeDefined();
  });

  it('E1 blackjack is deposited-only; payouts re-check "still play" under row locks', async () => {
    restore = economyOn();
    const play = await makeUser(SOL);
    const real = await funded();
    await expect(assertDepositedOnly(prisma as never, play.id, 'blackjack')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(assertDepositedOnly(prisma as never, real.id, 'blackjack')).resolves.toBeUndefined();
    const kept = await prisma.$transaction((tx) => stillPlay(tx, [play.id, real.id]));
    expect([...kept]).toEqual([play.id]);
  });
});
