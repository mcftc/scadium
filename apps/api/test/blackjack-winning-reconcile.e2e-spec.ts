import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, makeUser, makeSeed, makeBlackjackEngine } from './engine-harness';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * #190 — a WINNING blackjack round must leave the User win-aggregates with ZERO
 * reconciliation drift. `ReconciliationService.reconcileAll()` derives, per user,
 * from the `Bet` table:
 *   totalWagered = Σ amount
 *   totalWon     = Σ GREATEST(payout − amount, 0)   (NET win)
 *   totalLost    = Σ GREATEST(amount − payout, 0)   (NET loss)
 *   biggestWin   = GREATEST(MAX(payout − amount), 0)
 * so the blackjack settle must move `totalWon` by the NET win and
 * `biggestWin = max(biggestWin, payout − amount)`, or reconcile flags it
 * (the class of bug #187 fixed for lottery). Regression guard pinning the
 * corrected blackjack aggregate update.
 *
 * Reuses the double-settle winning-seat setup: a standing seat (19) beats the
 * dealer (18) → win, 2× main (1000 bet → 2000 payout, net +1000). Settles ONCE
 * (the legitimate win) and asserts payout > bet plus zero drift across all four
 * aggregates.
 */
const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);

const settle = (engine: unknown, t: unknown) =>
  (engine as { settle: (t: unknown) => Promise<void> }).settle(t);
const register = (engine: unknown, t: { id: string }) =>
  (engine as { tables: Map<string, unknown> }).tables.set(t.id, t);

/** A single standing seat (19) that beats the dealer (18) → win, 2× main. */
function makeTableState(opts: {
  tableId: string;
  roundDbId: string;
  seedId: string;
  userId: string;
  walletAddress: string;
}) {
  return {
    id: opts.tableId,
    name: 'win-reconcile',
    isPrivate: false,
    ownerId: null,
    maxSeats: 6,
    phase: 'dealer_turn',
    closeAt: null,
    activeSeat: null,
    seats: new Map([
      [
        0,
        {
          index: 0,
          userId: opts.userId,
          username: null,
          walletAddress: opts.walletAddress,
          idleRounds: 0,
          bet: { mainLamports: 1_000n, side21p3Lamports: 0n, sidePerfectPairsLamports: 0n },
          cards: [
            { rank: '10', suit: 'H' },
            { rank: '9', suit: 'S' },
          ],
          status: 'standing',
          doubled: false,
          side21p3Outcome: null,
          sidePerfectPairsOutcome: null,
          result: null,
          payoutLamports: 0n,
        },
      ],
    ]),
    dealerCards: [
      { rank: '10', suit: 'D' },
      { rank: '8', suit: 'C' },
    ],
    dealerHidden: false,
    deckIndex: 0,
    dealLog: [],
    roundDbId: opts.roundDbId,
    seedId: opts.seedId,
    serverSeed: 'srv-bj',
    serverSeedHash: 'hash-bj',
    clientSeed: 'cli-bj',
    nonce: 0,
    timer: null as NodeJS.Timeout | null,
    lastActivityAt: Date.now(),
  };
}

async function setupTable() {
  const table = await prisma.blackjackTable.create({
    data: {
      name: `bjwr-${randomUUID()}`,
      status: 'player_turns',
      minBetLamports: 1_000n,
      maxBetLamports: 1_000_000_000n,
    },
  });
  const seed = await makeSeed();
  const round = await prisma.blackjackRound.create({
    data: { tableId: table.id, seedId: seed.id, nonce: 0, endedAt: null, stateJson: {} },
  });
  return { table, seed, round };
}

async function driftRows(userId: string): Promise<number> {
  await prisma.reconciliationDrift.deleteMany({ where: { userId } });
  await reconciliation.reconcileAll();
  return prisma.reconciliationDrift.count({ where: { userId } });
}

describe('#190 — a winning blackjack round leaves win-aggregates with zero drift', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a 2× main win nets a positive win; aggregates reconcile (zero drift)', async () => {
    const u = await makeUser(0n);
    const { table, seed, round } = await setupTable();
    const t = makeTableState({
      tableId: table.id,
      roundDbId: round.id,
      seedId: seed.id,
      userId: u.id,
      walletAddress: u.walletAddress,
    });

    const engine = makeBlackjackEngine();
    register(engine, t);
    await settle(engine, t); // legitimate win: 1000 bet → 2000 payout (net +1000)
    if (t.timer) clearTimeout(t.timer);

    const bet = await prisma.bet.findFirstOrThrow({
      where: { userId: u.id, gameType: 'blackjack' },
    });
    expect(bet.payoutLamports).toBeGreaterThan(bet.amountLamports); // a real net win
    expect(bet.amountLamports).toBe(1_000n);
    expect(bet.payoutLamports).toBe(2_000n);
    expect(bet.status).toBe('won');

    // The denormalized User aggregates exactly equal the reconciler's derivation.
    const netWin = 2_000n - 1_000n;
    const u2 = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(u2.playBalanceLamports).toBe(2_000n);
    expect(u2.totalWagered).toBe(1_000n);
    expect(u2.totalWon).toBe(netWin);
    expect(u2.totalLost).toBe(0n);
    expect(u2.biggestWin).toBe(netWin);
    expect(u2.gamesPlayed).toBe(1);

    expect(await driftRows(u.id)).toBe(0);
  });
});
