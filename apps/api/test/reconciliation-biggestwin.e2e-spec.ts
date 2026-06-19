import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomInt } from 'node:crypto';
import { ticketPriceScadBase, scadBaseToLamports } from '@scadium/shared';
import { prisma, makeUser, makeSeed, makeLotteryEngine, makeJackpotEngine } from './engine-harness';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * #189 — crash/lottery/jackpot/blackjack settle must keep `User.biggestWin`
 * consistent (max net profit), matching `reconcileAll`'s
 * `GREATEST(MAX(payoutLamports - amountLamports), 0)` derivation. Before the fix
 * those paths wrote the winning Bet + totalWon but never biggestWin, so EVERY
 * real win drifted biggestWin — reconcileAll never returned 0 in normal play.
 *
 * This drives a real WINNING settle through the lottery and jackpot engines (the
 * two cleanly drivable via the engine-harness) and asserts FULL per-user zero
 * drift (every field, not field-filtered). reconcileAll scans all users, so we
 * isolate by asserting on the settled user's own ReconciliationDrift rows.
 */

const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);

/** Run reconcile and return THIS user's drifting fields (sorted). */
async function driftFields(userId: string): Promise<string[]> {
  await prisma.reconciliationDrift.deleteMany({ where: { userId } });
  await reconciliation.reconcileAll();
  const rows = await prisma.reconciliationDrift.findMany({ where: { userId } });
  return rows.map((r) => r.field).sort();
}

describe('reconciliation: settle paths keep biggestWin consistent (#189)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lottery: a winning ticket leaves ZERO drift (incl. biggestWin)', async () => {
    const cost = ticketPriceScadBase();
    const costLamports = scadBaseToLamports(cost);
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
    // 10 tickets covering leading digits 0-9 → exactly one wins the deterministic
    // synthetic draw; a large injected pool makes the win pay >> cost.
    for (let d = 0; d < 10; d++) {
      await prisma.lotteryTicket.create({
        data: {
          drawId: draw.id,
          userId: u.id,
          digits: [d, 0, 0, 0, 0, 0],
          costLamports,
          costScadBase: cost,
        },
      });
    }
    const engine = makeLotteryEngine();
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
      ticketCount: 10,
      ticketPriceScadBase: cost,
      injectionScadBase: cost * 1_000_000n,
      rolloverScadBase: 0n,
      salesScadBase: 0n,
      potLamports: 0n,
      commitTxSignature: null,
    };
    await (engine as unknown as { drawAndSettle: () => Promise<void> }).drawAndSettle();

    // Confirm a real win happened (otherwise the biggestWin path isn't exercised).
    const won = await prisma.bet.findFirst({
      where: { userId: u.id, gameType: 'lottery', payoutLamports: { gt: costLamports } },
    });
    expect(won).not.toBeNull();
    expect(await driftFields(u.id)).toEqual([]);
  });

  it('jackpot: the winner leaves ZERO drift (incl. biggestWin)', async () => {
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
    await (engine as unknown as { drawAndSettle: () => Promise<void> }).drawAndSettle();

    const after = await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(after.status).toBe('drawn');
    const winnerId = after.winnerId!;
    expect(winnerId).not.toBeNull();
    // The winner's net profit (pot − their stake) is positive → biggestWin must move.
    const winBet = await prisma.bet.findFirstOrThrow({
      where: { userId: winnerId, gameType: 'jackpot' },
    });
    expect(winBet.payoutLamports).toBeGreaterThan(winBet.amountLamports);

    // Both the winner and the loser must reconcile with zero drift.
    expect(await driftFields(winnerId)).toEqual([]);
    const loserId = winnerId === u1.id ? u2.id : u1.id;
    expect(await driftFields(loserId)).toEqual([]);
  });
});
