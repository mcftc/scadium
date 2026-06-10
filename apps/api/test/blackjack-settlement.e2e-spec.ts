import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, makeUser, makeSeed, makeBlackjackEngine } from './engine-harness';

/**
 * #62 — blackjack settlement atomicity (integration, real Postgres). The
 * blackjack `settle(t)` is private and timer-driven; we hand-build a minimal
 * in-memory TableState (a single standing seat that beats the dealer) and call
 * it directly. The table MUST be registered in the engine's `tables` map first
 * (settle builds a snapshot via `table(id)`). Induce a mid-settle failure with
 * a seat whose userId has no User row (P2025 in `tx.user.update`) → assert zero
 * partial effects, round NOT terminal (endedAt null), table not 'waiting',
 * in-memory phase rolled back to 'dealer_turn', seed not revealed, dead-letter.
 *
 * Hand: seat 10♥+9♠ (19) beats dealer 10♦+8♣ (18) → win, mainPayout = 2× main.
 * Side bets 0/none. Kept maximally simple so the literal is robust.
 */
function makeTableState(opts: {
  tableId: string;
  roundDbId: string;
  seedId: string;
  userId: string;
  walletAddress: string;
}) {
  const seat = {
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
  };
  return {
    id: opts.tableId,
    name: 'settle-test',
    isPrivate: false,
    ownerId: null,
    maxSeats: 6,
    phase: 'dealer_turn',
    closeAt: null,
    activeSeat: null,
    seats: new Map([[0, seat]]),
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
    data: { name: `bj-${randomUUID()}`, status: 'player_turns', minBetLamports: 1_000n, maxBetLamports: 1_000_000_000n },
  });
  const seed = await makeSeed();
  const round = await prisma.blackjackRound.create({
    data: { tableId: table.id, seedId: seed.id, nonce: 0, endedAt: null, stateJson: {} },
  });
  return { table, seed, round };
}

const settle = (engine: unknown, t: unknown) =>
  (engine as { settle: (t: unknown) => Promise<void> }).settle(t);
const register = (engine: unknown, t: { id: string }) =>
  (engine as { tables: Map<string, unknown> }).tables.set(t.id, t);

describe('blackjack settlement (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('happy path: winner paid 2x, Bet row, round ended, table waiting, seed revealed', async () => {
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
    await settle(engine, t);
    if (t.timer) clearTimeout(t.timer); // settle schedules a SETTLE_PAUSE_MS timer on success

    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports).toBe(2_000n);
    expect(await prisma.bet.count({ where: { userId: u.id, gameType: 'blackjack' } })).toBe(1);
    const roundAfter = await prisma.blackjackRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(roundAfter.endedAt).not.toBeNull();
    expect((await prisma.blackjackTable.findUniqueOrThrow({ where: { id: table.id } })).status).toBe('waiting');
    expect((await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } })).revealedAt).not.toBeNull();
    expect(await prisma.settlementFailure.count({ where: { gameType: 'blackjack', roundId: round.id } })).toBe(0);
  });

  it('induced failure: zero partial effects, round not ended, phase rolled back, dead-letter', async () => {
    const missing = randomUUID(); // no User row → tx.user.update throws P2025
    const { table, seed, round } = await setupTable();
    const t = makeTableState({
      tableId: table.id,
      roundDbId: round.id,
      seedId: seed.id,
      userId: missing,
      walletAddress: 'w-missing',
    });

    const engine = makeBlackjackEngine();
    register(engine, t);
    await settle(engine, t); // swallows the error

    const roundAfter = await prisma.blackjackRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(roundAfter.endedAt).toBeNull(); // NOT terminal
    expect((await prisma.blackjackTable.findUniqueOrThrow({ where: { id: table.id } })).status).not.toBe('waiting');
    expect(t.phase).toBe('dealer_turn'); // in-memory rollback
    expect((await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } })).revealedAt).toBeNull();
    expect(await prisma.bet.count({ where: { userId: missing } })).toBe(0);

    const failures = await prisma.settlementFailure.findMany({
      where: { gameType: 'blackjack', roundId: round.id },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.error).toMatch(/P2025|not found|No record/i);
  });
});
