import { randomInt } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ticketPriceScadBase, scadBaseToLamports } from '@scadium/shared';
import { prisma, makeUser, makeSeed, makeLotteryEngine } from './engine-harness';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * #187 — a lottery win must leave `totalWon`, `totalLost` AND `biggestWin` with
 * ZERO reconcile drift, including the awkward SUB-COST win (gross prize < ticket
 * cost). The `totalWon`/`biggestWin` halves of the premise were already fixed by
 * #183 (net basis, GREATEST(payout − cost, 0)), but the `totalLost` half was
 * still LIVE: settle gated the loss on `!won`, so a sub-cost "win" recorded a 0
 * loss while reconcileAll derives GREATEST(cost − payout, 0) > 0 from the Bet
 * row — drifting totalLost by exactly the shortfall. This spec proves all three
 * aggregates reconcile across a sub-cost win and a normal (net-positive) win.
 */
const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);

const COST_SCAD = ticketPriceScadBase();
const COST_LAMPORTS = scadBaseToLamports(COST_SCAD);

/** Open draw + 10 tickets for `userId`, one per leading digit 0..9 — exactly one
 *  matches the deterministic synthetic draw's first digit and wins. */
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

/** What reconcileAll recomputes from the unified Bet ledger for this user. */
async function derivedAggregates(userId: string) {
  const bets = await prisma.bet.findMany({
    where: { userId, gameType: 'lottery' },
    select: { amountLamports: true, payoutLamports: true },
  });
  let won = 0n;
  let lost = 0n;
  let biggest = 0n;
  for (const b of bets) {
    const net = b.payoutLamports > b.amountLamports ? b.payoutLamports - b.amountLamports : 0n;
    won += net;
    if (b.amountLamports > b.payoutLamports) lost += b.amountLamports - b.payoutLamports;
    if (net > biggest) biggest = net;
  }
  return { won, lost, biggest };
}

async function assertZeroDrift(userId: string) {
  await prisma.reconciliationDrift.deleteMany({ where: { userId } });
  await reconciliation.reconcileAll();
  for (const field of ['totalWon', 'totalLost', 'biggestWin']) {
    const drift = await prisma.reconciliationDrift.findMany({ where: { userId, field } });
    expect(drift, `expected zero ${field} drift`).toHaveLength(0);
  }
}

describe('#187 — lottery aggregates: sub-cost + normal win, zero drift', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('SUB-COST win (gross prize < cost): no totalWon/biggestWin inflation, no false loss', async () => {
    const u = await makeUser(0n);
    // No injection → pool is just the 10 ticket sales, of which 20% burns and the
    // winner-share is split across brackets, so the single winning ticket's prize
    // is necessarily LESS than its own cost. net profit = 0.
    const { seed, draw } = await setupCoveringDraw(u.id);
    const engine = makeLotteryEngine();
    prime(engine, draw, seed, 0n);
    await settle(engine);

    expect((await prisma.lotteryDraw.findUniqueOrThrow({ where: { id: draw.id } })).status).toBe(
      'drawn',
    );

    // The winning ticket exists and its gross prize is BELOW its cost (the case under test).
    const winner = await prisma.lotteryTicket.findFirst({ where: { drawId: draw.id, won: true } });
    expect(winner).not.toBeNull();
    expect(winner!.payoutLamports).toBeLessThan(winner!.costLamports);

    const derived = await derivedAggregates(u.id);
    expect(derived.won).toBe(0n); // sub-cost ⇒ net 0
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { totalWon: true, totalLost: true, biggestWin: true },
    });
    expect(stored.totalWon).toBe(derived.won);
    expect(stored.totalLost).toBe(derived.lost);
    expect(stored.biggestWin).toBe(derived.biggest);

    await assertZeroDrift(u.id);
  });

  it('NORMAL net-positive win (large injection): totalWon + biggestWin track the ledger, zero drift', async () => {
    const u = await makeUser(0n);
    const { seed, draw } = await setupCoveringDraw(u.id);
    const engine = makeLotteryEngine();
    prime(engine, draw, seed, COST_SCAD * 1_000_000n); // big pool ⇒ prize >> cost
    await settle(engine);

    const winner = await prisma.lotteryTicket.findFirst({ where: { drawId: draw.id, won: true } });
    expect(winner!.payoutLamports).toBeGreaterThan(winner!.costLamports);

    const derived = await derivedAggregates(u.id);
    expect(derived.won).toBeGreaterThan(0n);
    expect(derived.biggest).toBe(derived.won); // single winning ticket
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { totalWon: true, totalLost: true, biggestWin: true },
    });
    expect(stored.totalWon).toBe(derived.won);
    expect(stored.totalLost).toBe(derived.lost);
    expect(stored.biggestWin).toBe(derived.biggest);

    await assertZeroDrift(u.id);
  });
});
