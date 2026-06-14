import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JACKPOT, ticketPriceScadBase } from '@scadium/shared';
import {
  prisma,
  makeUser,
  makeSeed,
  makeCrashEngine,
  makeJackpotEngine,
  makeLotteryEngine,
  makeBlackjackEngine,
} from './engine-harness';

const recover = (engine: unknown, method = 'recoverStrandedRounds') =>
  (engine as Record<string, () => Promise<unknown>>)[method]!();

describe('round recovery on boot (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('crash: stranded running round → settled/refunded with ledger, honors partial cashout, no round left running', async () => {
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });
    const u1 = await makeUser(0n); // never cashed: amount 100, remaining 100, payout 0
    const u2 = await makeUser(0n); // partial: cashed 60% @3x (payout 180), remaining 40
    await prisma.crashBet.create({
      data: {
        roundId: round.id,
        userId: u1.id,
        amountLamports: 100n,
        remainingLamports: 100n,
        payoutLamports: 0n,
        won: false,
      },
    });
    await prisma.crashBet.create({
      data: {
        roundId: round.id,
        userId: u2.id,
        amountLamports: 100n,
        remainingLamports: 40n,
        payoutLamports: 180n,
        cashoutMultiplier: 3,
        won: true,
      },
    });

    await recover(makeCrashEngine());

    // u1: full stake refunded (0 + 100). u2: locked payout + remaining (180 + 40).
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u1.id } })).playBalanceLamports).toBe(
      100n,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u2.id } })).playBalanceLamports).toBe(
      220n,
    );
    expect((await prisma.crashRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'busted',
    );
    // Ledger entries exist for the recovery credits.
    expect(
      await prisma.balanceLedger.count({
        where: { userId: { in: [u1.id, u2.id] }, reason: 'crash_recovery_refund' },
      }),
    ).toBe(2);
    // No CrashRound left running/waiting for this seed's round.
    const stuck = await prisma.crashRound.findUnique({ where: { id: round.id } });
    expect(['waiting', 'running']).not.toContain(stuck!.status);
  });

  it('jackpot: stranded open round past closeAt → drawn/refunded, none left open', async () => {
    const seed = await makeSeed();
    const round = await prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'open', closeAt: new Date(Date.now() - 60_000) },
    });
    const users = [];
    for (let i = 0; i < JACKPOT.MIN_PLAYERS; i += 1) users.push(await makeUser(0n));
    for (const u of users) {
      await prisma.jackpotEntry.create({
        data: { roundId: round.id, userId: u.id, amountLamports: 1_000_000n },
      });
    }

    await recover(makeJackpotEngine());

    const after = await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(after.status).not.toBe('open'); // drawn or refunded
    // Value: total credited back equals payout (drawn) or sum of entries (refund).
    const credited = (
      await prisma.user.findMany({ where: { id: { in: users.map((u) => u.id) } } })
    ).reduce((s, u) => s + u.playBalanceLamports, 0n);
    expect(credited).toBeGreaterThan(0n);
  });

  it('lottery: stranded open draw past drawAt → settled synthetically, none left open', async () => {
    const seed = await makeSeed();
    const draw = await prisma.lotteryDraw.create({
      data: {
        seedId: seed.id,
        nonce: 0,
        status: 'open',
        drawIndex: BigInt(Date.now()),
        drawAt: new Date(Date.now() - 60_000),
      },
    });
    const u = await makeUser(0n);
    await prisma.lotteryTicket.create({
      data: {
        drawId: draw.id,
        userId: u.id,
        digits: [1, 2, 3, 4, 5, 6],
        costLamports: BigInt(0),
        costScadBase: ticketPriceScadBase(),
      },
    });

    await recover(makeLotteryEngine(), 'recoverStrandedDraws');

    expect((await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: draw.id } })).status).not.toBe(
      'open',
    );
  });

  it('blackjack: unfinished round → seat stakes refunded with ledger, table back to waiting', async () => {
    const table = await prisma.blackjackTable.create({
      data: {
        name: `rec-${Date.now().toString(36)}`,
        status: 'player_turns',
        minBetLamports: 1_000n,
        maxBetLamports: 1_000_000_000n,
      },
    });
    const seed = await makeSeed();
    const u = await makeUser(0n); // debited 150 (100 main + 50 side)
    await prisma.blackjackRound.create({
      data: {
        tableId: table.id,
        seedId: seed.id,
        nonce: 0,
        endedAt: null,
        stateJson: {
          seats: [
            {
              userId: u.id,
              bet: { mainLamports: '100', side21p3Lamports: '50', sidePerfectPairsLamports: '0' },
            },
          ],
        },
      },
    });

    await recover(makeBlackjackEngine());

    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(
      150n,
    );
    expect((await prisma.blackjackTable.findUniqueOrThrow({ where: { id: table.id } })).status).toBe(
      'waiting',
    );
    expect(
      await prisma.balanceLedger.count({
        where: { userId: u.id, reason: 'blackjack_recovery_refund' },
      }),
    ).toBe(1);
  });

  it('blackjack: double mid-hand → restart refunds the DOUBLED stake (#68), not the original', async () => {
    // Two seated players so the round stays in player_turns after the double
    // (no auto-settle): seat 0 doubles, seat 1 is still to act.
    const u0 = await makeUser(0n); // main 1000 → doubled to 2000
    const u1 = await makeUser(0n); // main 500, untouched
    const table = await prisma.blackjackTable.create({
      data: {
        name: `bj-dbl-${Date.now().toString(36)}`,
        status: 'player_turns',
        minBetLamports: 1_000n,
        maxBetLamports: 1_000_000_000n,
      },
    });
    const seed = await makeSeed();
    // Deal-time snapshot (#14): pre-double stakes. Old code leaves this untouched
    // on a double, so recovery would under-refund seat 0 (1000 instead of 2000).
    const round = await prisma.blackjackRound.create({
      data: {
        tableId: table.id,
        seedId: seed.id,
        nonce: 0,
        endedAt: null,
        stateJson: {
          seats: [
            { userId: u0.id, bet: { mainLamports: '1000', side21p3Lamports: '0', sidePerfectPairsLamports: '0' } },
            { userId: u1.id, bet: { mainLamports: '500', side21p3Lamports: '0', sidePerfectPairsLamports: '0' } },
          ],
        },
      },
    });

    const mkSeat = (
      index: number,
      userId: string,
      wallet: string,
      main: bigint,
      cards: { rank: string; suit: string }[],
    ) => ({
      index,
      userId,
      username: null,
      walletAddress: wallet,
      idleRounds: 0,
      bet: { mainLamports: main, side21p3Lamports: 0n, sidePerfectPairsLamports: 0n },
      cards,
      status: 'playing',
      doubled: false,
      side21p3Outcome: null,
      sidePerfectPairsOutcome: null,
      result: null,
      payoutLamports: 0n,
    });
    const t = {
      id: table.id,
      name: 'dbl-test',
      isPrivate: false,
      ownerId: null,
      maxSeats: 6,
      phase: 'player_turns',
      closeAt: Date.now() + 30_000,
      activeSeat: 0,
      seats: new Map<number, unknown>([
        [0, mkSeat(0, u0.id, u0.walletAddress, 1_000n, [{ rank: '10', suit: 'H' }, { rank: '6', suit: 'S' }])],
        [1, mkSeat(1, u1.id, u1.walletAddress, 500n, [{ rank: '10', suit: 'D' }, { rank: '9', suit: 'C' }])],
      ]),
      dealerCards: [{ rank: '7', suit: 'D' }, { rank: '5', suit: 'C' }],
      dealerHidden: true,
      deckIndex: 4,
      dealLog: [],
      roundDbId: round.id,
      seedId: seed.id,
      serverSeed: 'srv-dbl',
      serverSeedHash: 'hash-dbl',
      clientSeed: 'cli-dbl',
      nonce: 0,
      timer: null as NodeJS.Timeout | null,
      lastActivityAt: Date.now(),
    };

    const engine = makeBlackjackEngine();
    (engine as unknown as { tables: Map<string, unknown> }).tables.set(t.id, t);
    // The double re-persists stateJson with the doubled stake (the #68 fix).
    await (
      engine as unknown as {
        action: (p: { tableId: string; userId: string; action: string }) => Promise<unknown>;
      }
    ).action({ tableId: table.id, userId: u0.id, action: 'double' });
    if (t.timer) clearTimeout(t.timer); // advanceTurn scheduled a turn timer for seat 1

    // In-memory stake doubled; round still unfinished (advanced to seat 1, no settle).
    expect((t.seats.get(0) as { bet: { mainLamports: bigint } }).bet.mainLamports).toBe(2_000n);
    expect(
      (await prisma.blackjackRound.findUniqueOrThrow({ where: { id: round.id } })).endedAt,
    ).toBeNull();

    // Simulate restart: a fresh engine recovers stranded rounds from Postgres.
    await recover(makeBlackjackEngine());

    // Seat 0 gets the DOUBLED stake back (2000), not the original 1000.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u0.id } })).playBalanceLamports).toBe(
      2_000n,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u1.id } })).playBalanceLamports).toBe(
      500n,
    );
    expect((await prisma.blackjackTable.findUniqueOrThrow({ where: { id: table.id } })).status).toBe(
      'waiting',
    );
    expect(
      await prisma.balanceLedger.count({
        where: { userId: u0.id, reason: 'blackjack_recovery_refund' },
      }),
    ).toBe(1);
  });
});
