import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { JACKPOT, ticketPriceScadBase, scadBaseToLamports } from '@scadium/shared';
import { JackpotService } from '../src/games/jackpot/jackpot.service';
import { LotteryService } from '../src/games/lottery/lottery.service';
import {
  prisma,
  makeUser,
  makeSeed,
  makeJackpotEngine,
  makeLotteryEngine,
  offChain,
} from './engine-harness';

/**
 * #215 — late-entry orphan window. A jackpot enter / lottery buy gated only by
 * the in-memory getOpenRound()/getOpenDraw() check could be debited + persist an
 * entry/ticket on a round the settle had ALREADY claimed terminal (its entries
 * read before the claim), leaving an orphaned stake (debited BalanceLedger with
 * no Bet, no settlement, no refund → reconcileAll drift).
 *
 * The fix closes the window on BOTH sides:
 *  1. settle reads entries/tickets INSIDE the serializable tx, after the #212
 *     claim (so an entry committed before the claim is always settled/refunded);
 *  2. enter/buy re-asserts the round/draw is still open at commit via a guarded
 *     no-op updateMany, rolling the WHOLE tx (debit + entry) back when it isn't.
 *
 * This spec drives the REAL service enter()/buyTicket() paths against the same
 * primed engine the settlement specs use: settle a round to terminal, then race
 * a late entry/buy and assert it is fully rejected with the debit rolled back —
 * never an orphan — and that reconcileAll sees zero drift for that user.
 */

/** RG stub: the late-entry race, not the responsible-gambling gates, is under test. */
const rgStub = { assertCanWager: async () => undefined } as never;

/** Reconstruct `this.current` from a DB round (like recovery) so settle/enter act on it. */
function primeJackpot(
  engine: unknown,
  round: { id: string },
  seed: { id: string; serverSeed: string | null; serverSeedHash: string; clientSeed: string },
  closeAt: number,
) {
  const e = engine as Record<string, unknown>;
  e.recovering = true; // suppress the chained openNewRound() after settle
  e.current = {
    id: round.id,
    seedId: seed.id,
    serverSeed: seed.serverSeed,
    serverSeedHash: seed.serverSeedHash,
    clientSeed: seed.clientSeed,
    nonce: 0,
    closeAt,
    status: 'open',
    totalLamports: 0n,
    players: new Set<string>(),
  };
}

function primeLottery(
  engine: unknown,
  draw: { id: string; drawIndex: bigint | null },
  seed: { id: string; serverSeed: string | null; serverSeedHash: string; clientSeed: string },
  drawAt: number,
) {
  const e = engine as Record<string, unknown>;
  e.recovering = true;
  e.current = {
    id: draw.id,
    drawIndex: draw.drawIndex ?? 0n,
    seedId: seed.id,
    serverSeed: seed.serverSeed,
    serverSeedHash: seed.serverSeedHash,
    clientSeed: seed.clientSeed,
    nonce: 0,
    drawAt,
    status: 'open',
    ticketCount: 0,
    ticketPriceScadBase: ticketPriceScadBase(),
    injectionScadBase: 0n,
    rolloverScadBase: 0n,
    salesScadBase: 0n,
    potLamports: 0n,
    commitTxSignature: null,
    targetSlot: null,
  };
}

const settle = (engine: unknown) =>
  (engine as { drawAndSettle: () => Promise<void> }).drawAndSettle();

/** All ledger rows the user has for this round/draw ref (orphan detector). */
async function ledgerFor(userId: string, refType: string, refId: string) {
  return prisma.balanceLedger.findMany({ where: { userId, refType, refId } });
}

describe('#215 late-entry orphan window (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('jackpot: a late enter on a settled (terminal) round is rejected — debit rolled back, no orphan', async () => {
    // One entry → < MIN_PLAYERS → the round refunds + flips terminal on settle.
    const seeder = await makeUser(0n);
    const seed = await makeSeed();
    const round = await prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'open', closeAt: new Date(Date.now() + 60_000) },
    });
    await prisma.jackpotEntry.create({
      data: { roundId: round.id, userId: seeder.id, amountLamports: 1_000_000n },
    });

    const engine = makeJackpotEngine();
    // Round still "open" in memory (closeAt in the future) so the live enter
    // guard's pre-tx getOpenRound() passes — exactly the orphan race.
    primeJackpot(engine, round, seed, Date.now() + 60_000);
    await settle(engine); // claims the round terminal (refunded)

    expect((await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'refunded',
    );

    // The late player has funds and the in-memory round still reads "open".
    const latecomer = await makeUser(5_000_000n);
    const svc = new JackpotService(prisma as never, engine as never, rgStub);

    await expect(
      svc.enter({ userId: latecomer.id, amountLamports: BigInt(JACKPOT.MIN_ENTRY_LAMPORTS) }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Debit fully rolled back: balance untouched, NO debit ledger row, NO entry.
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: latecomer.id } })).playBalanceLamports,
    ).toBe(5_000_000n);
    expect(await ledgerFor(latecomer.id, 'JackpotRound', round.id)).toHaveLength(0);
    expect(
      await prisma.jackpotEntry.count({ where: { roundId: round.id, userId: latecomer.id } }),
    ).toBe(0);
  });

  it('jackpot: an entry committed BEFORE the claim is always settled (no orphan), reconcile zero-drift', async () => {
    // Two distinct players → draw path; both entries exist pre-settle, so both
    // must end with a Bet row + a matched ledger (winner credited, loser not).
    const u1 = await makeUser(0n);
    const u2 = await makeUser(0n);
    const seed = await makeSeed();
    const round = await prisma.jackpotRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'open', closeAt: new Date(Date.now() - 60_000) },
    });
    for (const u of [u1, u2]) {
      await prisma.jackpotEntry.create({
        data: { roundId: round.id, userId: u.id, amountLamports: 1_000_000n },
      });
    }

    const engine = makeJackpotEngine();
    primeJackpot(engine, round, seed, Date.now());
    await settle(engine);

    expect((await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'drawn',
    );
    // Every entrant got a Bet row (settled — never orphaned).
    expect(
      await prisma.bet.count({ where: { gameType: 'jackpot', userId: { in: [u1.id, u2.id] } } }),
    ).toBe(2);

    // reconcileAll: each user's live balance must equal their ledger projection.
    const { ReconciliationService } = await import('../src/reconciliation/reconciliation.service');
    const recon = new ReconciliationService(
      prisma as never,
      { enabled: false, lotteryEnabled: false } as never,
    );
    await recon.reconcileAll();
    for (const u of [u1, u2]) {
      const rows = await prisma.reconciliationDrift.findMany({ where: { userId: u.id } });
      expect(rows).toHaveLength(0);
    }
  });

  it('lottery: a late buy on a settled (terminal) draw is rejected — debit rolled back, no orphan', async () => {
    const seed = await makeSeed();
    const draw = await prisma.lotteryDraw.create({
      data: {
        seedId: seed.id,
        nonce: 0,
        status: 'open',
        drawIndex: BigInt(Math.floor(Math.random() * 2_000_000_000) + 1),
        drawAt: new Date(Date.now() + 60_000),
        ticketPriceScadBase: ticketPriceScadBase(),
      },
    });

    const engine = makeLotteryEngine();
    primeLottery(engine, draw, seed, Date.now() + 60_000);
    await settle(engine); // claims the draw terminal (drawn)

    expect((await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: draw.id } })).status).toBe(
      'drawn',
    );

    const price = scadBaseToLamports(ticketPriceScadBase());
    const latecomer = await makeUser(price * 10n);
    // chain disabled (offChain) → buyTicket takes the play-money debit path.
    const svc = new LotteryService(prisma as never, engine as never, offChain, rgStub);

    await expect(
      svc.buyTicket({ userId: latecomer.id, digits: [1, 2, 3, 4, 5, 6] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: latecomer.id } })).playBalanceLamports,
    ).toBe(price * 10n);
    expect(await ledgerFor(latecomer.id, 'LotteryDraw', draw.id)).toHaveLength(0);
    expect(
      await prisma.lotteryTicket.count({ where: { drawId: draw.id, userId: latecomer.id } }),
    ).toBe(0);
  });
});
