import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomInt } from 'node:crypto';
import { ticketPriceScadBase, scadBaseToLamports } from '@scadium/shared';
import {
  prisma,
  makeUser,
  makeSeed,
  makeJackpotEngine,
  makeLotteryEngine,
  makeCrashEngine,
} from '../engine-harness';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';

/**
 * #212 — the singleton engines must settle a round EXACTLY ONCE even if two
 * settlers race it (a stalled-then-resumed leader, a recovery pass racing a live
 * settle, or a demoted leader still mid-settle). The fix: re-assert leadership +
 * a status-guarded terminal flip ("claim") as the first writes inside the settle
 * tx; the loser matches 0 rows and rolls the whole tx back (no double credit).
 *
 * This drives a real settle, then settles the SAME round a second time, and
 * asserts the second attempt is a no-op (no extra credit, no extra Bet row, no
 * reconciliation drift). It also asserts a demoted leader credits no one.
 */

const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);

const settle = (engine: unknown) =>
  (engine as unknown as { drawAndSettle: () => Promise<void> }).drawAndSettle();

async function driftRows(userIds: string[]): Promise<number> {
  await prisma.reconciliationDrift.deleteMany({ where: { userId: { in: userIds } } });
  await reconciliation.reconcileAll();
  return prisma.reconciliationDrift.count({ where: { userId: { in: userIds } } });
}

function primeJackpot(engine: unknown, round: { id: string }, seed: Record<string, unknown>) {
  const e = engine as unknown as Record<string, unknown>;
  e.recovering = true;
  e.current = {
    id: round.id,
    seedId: seed.id,
    serverSeed: seed.serverSeed,
    serverSeedHash: seed.serverSeedHash,
    clientSeed: seed.clientSeed,
    nonce: 0,
    closeAt: Date.now(),
    status: 'open',
    totalLamports: 0n,
    players: new Set<string>(),
  };
}

describe('#212 — settle is idempotent under a two-settler race (no double payout)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('jackpot: settling the same round twice credits the winner exactly once', async () => {
    const u1 = await makeUser(0n);
    const u2 = await makeUser(0n);
    const seed = await makeSeed();
    const round = await prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'open', closeAt: new Date(Date.now() - 60_000) },
    });
    for (const id of [u1.id, u2.id]) {
      await prisma.jackpotEntry.create({
        data: { roundId: round.id, userId: id, amountLamports: 1_000_000n },
      });
    }

    const engine = makeJackpotEngine();
    primeJackpot(engine, round, seed as unknown as Record<string, unknown>);
    await settle(engine); // first (legitimate) settle

    const afterFirst = await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(afterFirst.status).toBe('drawn');
    const balAfterFirst = (
      await prisma.user.findMany({ where: { id: { in: [u1.id, u2.id] } } })
    ).reduce((s, u) => s + u.playBalanceLamports, 0n);
    const betsAfterFirst = await prisma.bet.count({ where: { userId: { in: [u1.id, u2.id] } } });
    expect(betsAfterFirst).toBe(2); // one Bet per entry

    // Second settler races the same round (re-prime as a recovery pass would).
    primeJackpot(engine, round, seed as unknown as Record<string, unknown>);
    await settle(engine); // must be a benign no-op (round already 'drawn')

    const balAfterSecond = (
      await prisma.user.findMany({ where: { id: { in: [u1.id, u2.id] } } })
    ).reduce((s, u) => s + u.playBalanceLamports, 0n);
    expect(balAfterSecond).toBe(balAfterFirst); // NOT double-credited
    expect(await prisma.bet.count({ where: { userId: { in: [u1.id, u2.id] } } })).toBe(2); // no extra Bet rows
    expect(await driftRows([u1.id, u2.id])).toBe(0); // zero reconciliation drift
  });

  it('lottery: settling the same draw twice settles tickets exactly once', async () => {
    const cost = ticketPriceScadBase();
    const u = await makeUser(0n);
    const seed = await makeSeed();
    const drawIndex = BigInt(randomInt(1, 2_000_000_000));
    const draw = await prisma.lotteryDraw.create({
      data: {
        seedId: seed.id,
        nonce: 0,
        status: 'open',
        drawIndex,
        drawAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.lotteryTicket.create({
      data: {
        drawId: draw.id,
        userId: u.id,
        digits: [1, 2, 3, 4, 5, 6],
        costLamports: scadBaseToLamports(cost),
        costScadBase: cost,
      },
    });

    const prime = (engine: unknown) => {
      const e = engine as unknown as Record<string, unknown>;
      e.recovering = true;
      e.current = {
        id: draw.id,
        drawIndex,
        seedId: seed.id,
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce: 0,
        drawAt: Date.now(),
        status: 'open',
        ticketCount: 1,
        ticketPriceScadBase: cost,
        injectionScadBase: 0n,
        rolloverScadBase: 0n,
        salesScadBase: 0n,
        potLamports: 0n,
        commitTxSignature: null,
      };
    };

    const engine = makeLotteryEngine();
    prime(engine);
    await settle(engine);
    expect((await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: draw.id } })).status).toBe(
      'drawn',
    );
    const betsAfterFirst = await prisma.bet.count({ where: { userId: u.id, gameType: 'lottery' } });
    expect(betsAfterFirst).toBe(1);
    const balAfterFirst = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } }))
      .playBalanceLamports;

    prime(engine); // second settler
    await settle(engine); // benign no-op

    expect(await prisma.bet.count({ where: { userId: u.id, gameType: 'lottery' } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(
      balAfterFirst,
    );
    // (No reconcileAll assertion here: a lone self-funded ticket can be a sub-cost
    // "winner" whose totalLost drift is the SEPARATE known bug #187 — unrelated to
    // the #212 double-settle property, which the single-Bet + unchanged-balance
    // checks above already prove. The jackpot test covers full zero-drift.)
  });

  it('demoted leader: a settler that has lost leadership credits no one', async () => {
    const u1 = await makeUser(0n);
    const u2 = await makeUser(0n);
    const seed = await makeSeed();
    const round = await prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'open', closeAt: new Date(Date.now() - 60_000) },
    });
    for (const id of [u1.id, u2.id]) {
      await prisma.jackpotEntry.create({
        data: { roundId: round.id, userId: id, amountLamports: 1_000_000n },
      });
    }

    const engine = makeJackpotEngine();
    primeJackpot(engine, round, seed as unknown as Record<string, unknown>);
    // Demote: assertStillLeader must abort the settle before any credit.
    (engine as unknown as { isLeader: () => boolean }).isLeader = () => false;
    await settle(engine);

    // Round untouched, nobody credited, no Bet rows.
    expect((await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'open',
    );
    const bal = (await prisma.user.findMany({ where: { id: { in: [u1.id, u2.id] } } })).reduce(
      (s, u) => s + u.playBalanceLamports,
      0n,
    );
    expect(bal).toBe(0n);
    expect(await prisma.bet.count({ where: { userId: { in: [u1.id, u2.id] } } })).toBe(0);
  });

  it('crash: recovering the same stranded round twice refunds exactly once', async () => {
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });
    const u = await makeUser(0n); // never cashed: amount 100, remaining 100
    await prisma.crashBet.create({
      data: {
        roundId: round.id,
        userId: u.id,
        amountLamports: 100n,
        remainingLamports: 100n,
        payoutLamports: 0n,
        won: false,
      },
    });

    const recover = (engine: unknown) =>
      (engine as unknown as { recoverStrandedRounds: () => Promise<void> }).recoverStrandedRounds();

    await recover(makeCrashEngine()); // first recovery: refund 100, round → busted
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(
      100n,
    );
    expect((await prisma.crashRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'busted',
    );

    // A second recovery pass (a racing/restarted replica) must NOT refund again.
    await recover(makeCrashEngine());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(
      100n,
    );
    expect(
      await prisma.balanceLedger.count({
        where: { userId: u.id, reason: 'crash_recovery_refund' },
      }),
    ).toBe(1); // exactly one refund ledger row, not two
    expect(await prisma.bet.count({ where: { userId: u.id, gameType: 'crash' } })).toBe(1);
    expect(await driftRows([u.id])).toBe(0);
  });
});
