import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, makeUser, makeSeed, makeBlackjackEngine } from '../engine-harness';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';

/**
 * #219 — blackjack had the same double-settle hole as #212 (crash/jackpot/lottery):
 * no in-tx leadership re-check and an unconditional terminal `endedAt` flip, so a
 * stalled/demoted leader or a recovery-vs-live race could credit a winning seat
 * twice. The fix reuses settle-claim.ts: assertStillLeader + a guarded
 * `updateMany({ where: { id, endedAt: null } })` claim as the first tx writes.
 *
 * This settles a winning round, then settles the SAME round again, and asserts
 * the second is a benign no-op (no extra credit, no extra Bet row, endedAt
 * unchanged, zero drift); plus a demoted leader credits no one.
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
    name: 'ds-test',
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
      name: `bjds-${randomUUID()}`,
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

describe('#219 — blackjack settle is idempotent under a two-settler race', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('settling the same winning round twice pays the seat exactly once', async () => {
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
    await settle(engine, t); // first (legitimate) settle: 1000 bet → 2000 payout
    if (t.timer) clearTimeout(t.timer);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(
      2_000n,
    );
    expect(await prisma.bet.count({ where: { userId: u.id, gameType: 'blackjack' } })).toBe(1);
    const endedAtFirst = (
      await prisma.blackjackRound.findUniqueOrThrow({ where: { id: round.id } })
    ).endedAt;
    expect(endedAtFirst).not.toBeNull();

    // Second settler races the same round (endedAt already set) → benign no-op.
    await settle(engine, t);
    if (t.timer) clearTimeout(t.timer);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(
      2_000n,
    ); // NOT double-paid
    expect(await prisma.bet.count({ where: { userId: u.id, gameType: 'blackjack' } })).toBe(1);
    expect(
      (await prisma.blackjackRound.findUniqueOrThrow({ where: { id: round.id } })).endedAt,
    ).toStrictEqual(endedAtFirst); // unchanged
    expect(await driftRows(u.id)).toBe(0);
  });

  it('a demoted leader credits no one', async () => {
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
    (engine as unknown as { isLeader: () => boolean }).isLeader = () => false;
    await settle(engine, t);
    if (t.timer) clearTimeout(t.timer);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(
      0n,
    );
    expect(await prisma.bet.count({ where: { userId: u.id, gameType: 'blackjack' } })).toBe(0);
    expect(
      (await prisma.blackjackRound.findUniqueOrThrow({ where: { id: round.id } })).endedAt,
    ).toBeNull();
  });
});
