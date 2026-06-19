import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomInt } from 'node:crypto';
import { ticketPriceScadBase, scadBaseToLamports } from '@scadium/shared';
import { prisma, makeUser, makeSeed, makeLotteryEngine } from './engine-harness';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * #183 — lottery settle must increment `User.totalWon` by NET (payout − cost),
 * matching `reconcileAll`'s `SUM(GREATEST(payoutLamports - amountLamports, 0))`
 * derivation and the crash settle path. Before the fix it incremented by the
 * GROSS payout, so EVERY winning lottery ticket flagged a false `totalWon`
 * drift of exactly the ticket cost — masking real drift in production.
 *
 * This proves a settled WINNING ticket produces zero `totalWon` drift. We assert
 * field-specifically on `totalWon`: a winning ticket separately drifts
 * `biggestWin` (lottery settle never updates it — a pre-existing systemic gap
 * shared with crash, tracked as a follow-up), which is out of #183's scope.
 */

const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);

const COST_SCAD = ticketPriceScadBase();
const COST_LAMPORTS = scadBaseToLamports(COST_SCAD);

/** Open draw + 10 tickets for `userId`, one per leading digit 0..9 — so exactly
 *  one matches the deterministic synthetic draw's first digit and wins. */
async function setupCoveringDraw(userId: string) {
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
  for (let d = 0; d < 10; d++) {
    await prisma.lotteryTicket.create({
      data: {
        drawId: draw.id,
        userId,
        digits: [d, 0, 0, 0, 0, 0],
        costLamports: COST_LAMPORTS,
        costScadBase: COST_SCAD,
      },
    });
  }
  return { seed, draw };
}

function prime(
  engine: unknown,
  draw: { id: string; drawIndex: bigint | null },
  seed: { id: string; serverSeed: string | null; serverSeedHash: string; clientSeed: string },
  injectionScadBase: bigint,
) {
  const e = engine as Record<string, unknown>;
  e.recovering = true;
  e.current = {
    id: draw.id,
    drawIndex: draw.drawIndex,
    seedId: seed.id,
    serverSeed: seed.serverSeed,
    serverSeedHash: seed.serverSeedHash,
    clientSeed: seed.clientSeed,
    nonce: 0,
    drawAt: Date.now(),
    status: 'open',
    ticketCount: 10,
    ticketPriceScadBase: COST_SCAD,
    injectionScadBase,
    rolloverScadBase: 0n,
    salesScadBase: 0n,
    potLamports: 0n,
    commitTxSignature: null,
  };
}
const settle = (engine: unknown) =>
  (engine as { drawAndSettle: () => Promise<void> }).drawAndSettle();

/** This user's net winnings derived from the unified Bet ledger (what reconcile
 *  recomputes): SUM(GREATEST(payout - amount, 0)). */
async function derivedNetWon(userId: string): Promise<bigint> {
  const bets = await prisma.bet.findMany({
    where: { userId, gameType: 'lottery' },
    select: { amountLamports: true, payoutLamports: true },
  });
  return bets.reduce(
    (acc, b) =>
      acc + (b.payoutLamports > b.amountLamports ? b.payoutLamports - b.amountLamports : 0n),
    0n,
  );
}

describe('lottery reconciliation: totalWon is NET, not gross (#183)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a winning lottery ticket produces ZERO totalWon drift (gross would over-count by the cost)', async () => {
    const u = await makeUser(0n);
    // A large injected pool guarantees the matched bracket pays out > the cost.
    const { seed, draw } = await setupCoveringDraw(u.id);
    const engine = makeLotteryEngine();
    prime(engine, draw, seed, COST_SCAD * 1_000_000n);
    await settle(engine);

    // Sanity: the draw settled and the user actually has a winning Bet whose
    // gross payout exceeds its cost (otherwise the gross/net gap is unobservable).
    expect((await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: draw.id } })).status).toBe(
      'drawn',
    );
    const net = await derivedNetWon(u.id);
    expect(net).toBeGreaterThan(0n);

    // Stored aggregate must equal the net derived from the ledger — the fix.
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { totalWon: true },
    });
    expect(stored.totalWon).toBe(net);

    // And reconciliation must flag NO totalWon drift for this user.
    await prisma.reconciliationDrift.deleteMany({ where: { userId: u.id } });
    await reconciliation.reconcileAll();
    const totalWonDrift = await prisma.reconciliationDrift.findMany({
      where: { userId: u.id, field: 'totalWon' },
    });
    expect(totalWonDrift).toHaveLength(0);
  });

  it('a single-ticket draw produces zero totalWon drift whatever the outcome (no regression)', async () => {
    // No injected pool — a single ticket can only ever self-fund a sub-cost prize
    // (or lose). Either way the #183 invariant must hold: totalWon never drifts.
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
        digits: [7, 7, 7, 7, 7, 7],
        costLamports: COST_LAMPORTS,
        costScadBase: COST_SCAD,
      },
    });
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
      ticketCount: 1,
      ticketPriceScadBase: COST_SCAD,
      injectionScadBase: 0n,
      rolloverScadBase: 0n,
      salesScadBase: 0n,
      potLamports: 0n,
      commitTxSignature: null,
    };
    await settle(engine);

    // Stored totalWon must equal the net derived from the ledger (the #183 fix),
    // and reconciliation must flag no totalWon drift.
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { totalWon: true },
    });
    expect(stored.totalWon).toBe(await derivedNetWon(u.id));
    await prisma.reconciliationDrift.deleteMany({ where: { userId: u.id } });
    await reconciliation.reconcileAll();
    const totalWonDrift = await prisma.reconciliationDrift.findMany({
      where: { userId: u.id, field: 'totalWon' },
    });
    expect(totalWonDrift).toHaveLength(0);
  });
});
